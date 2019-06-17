const schedule = require("node-schedule");
const cfenv = require("cfenv");
const superagent = require("superagent");
const s3 = require("s3-client");
const orgInputLocalFileLocation = "/home/vcap/tmp/input-orgs.json";
const scrapeResultLocalFileLocation = "/home/vcap/tmp/scrape-result.json";
const outputBucketName = "output";
const scrapeFileName = "scrape-result.json";
const scrapeFileBackupName = "scrape-result-backup.json";
const fs = require("fs");

var appenv = cfenv.getAppEnv();
var apiUrl = appenv.app.cf_api;
var auditorCreds = appenv.getServiceCreds("cf-api-credentials");

console.log(appenv.app.name + " starting up. Using the following parameters:");
console.log("CF api url: " + apiUrl);
console.log("auditor username: " + auditorCreds.username);
console.log("auditor password not logged");

console.log(
  "starting cf-scraper, scheduling job with schedule " +
    process.env.SYNC_SCHEDULE
);

var s3Creds = appenv.getServiceCreds("orgs-store");
console.log("creating S3 client for enpoint: " + s3Creds.namespaceHost);
var s3Client = s3.createClient({
  s3Options: {
    accessKeyId: s3Creds.accessKey,
    secretAccessKey: s3Creds.sharedSecret,
    endpoint: s3Creds.accessHost
  }
});

function getToken(authEndpoint) {
  return superagent
    .post(authEndpoint + "/oauth/token")
    .type("form")
    .send({
      "2factor": "",
      grant_type: "password",
      password: auditorCreds.password,
      username: auditorCreds.username,
      scope: ""
    })
    .set("Content-Type", "application/x-www-form-urlencoded")
    .set("Authorization", "Basic Y2Y6")
    .set("Accept", "application/json");
}

function getOrg(login, orgName) {
  return superagent
    .get(apiUrl + "/v2/organizations")
    .set("Authorization", "Bearer " + login.body.access_token)
    .set("Accept", "application/json")
    .query({ q: "name:" + orgName });
}

function getResource(login, url) {
  console.log("getting resource " + url);
  return superagent
    .get(apiUrl + url)
    .set("Authorization", "Bearer " + login.body.access_token)
    .set("Accept", "application/json");
}

async function getResourceAllPages(login, url) {
  var result = [];
  var firstPage = await getResource(login, url);
  result = result.concat(firstPage.body.resources);
  var safetyCounter = 1;
  var page = firstPage;
  while (page.body.next_url != null && safetyCounter < page.body.total_pages) {
    page = await getResources(login, page.next_url);
    result = result.concat(page.body.resources);
    safetyCounter++;
  }
  return result;
}

function backupScrapeResult(onSuccess) {
  var params = {
    CopySource: "/" + outputBucketName + "/" + scrapeFileName,
    Bucket: outputBucketName,
    Key: scrapeFileBackupName
  };
  var copier = s3Client.copyObject(params);
  copier.on("error", function(err) {
    console.error("unable to backup output file in S3", err.stack);
  });
  copier.on("end", function() {
    console.log("done backing up output file in S3");
    onSuccess();
  });
}

function uploadScrapeResult(scrapeResult) {
  fs.writeFileSync(scrapeResultLocalFileLocation, JSON.stringify(scrapeResult));
  var params = {
    localFile: scrapeResultLocalFileLocation,

    s3Params: {
      Bucket: outputBucketName,
      Key: scrapeFileName
    }
  };
  var uploader = s3Client.uploadFile(params);
  uploader.on("error", function(err) {
    console.error("unable to upload scrape result to S3:", err.stack);
  });
  uploader.on("progress", function() {
    console.log(
      "progress uploading scrape result to S3",
      uploader.progressMd5Amount,
      uploader.progressAmount,
      uploader.progressTotal
    );
  });
  uploader.on("end", function() {
    console.log("done uploading scrape result to S3");
  });
}

async function scrape() {
  try {
    console.log("getting api info on " + apiUrl);
    const info = await superagent.get(apiUrl + "/v2/info");
    console.log(
      "logging in using endpoint: " + info.body.authorization_endpoint
    );
    const login = await getToken(info.body.authorization_endpoint);
    console.log(
      "reading org input file from local disk " + orgInputLocalFileLocation
    );
    let rawinputorgs = fs.readFileSync(orgInputLocalFileLocation);
    let inputorgs = JSON.parse(rawinputorgs);
    console.log("org input file loaded");
    var scrapeResult = {};
    await Promise.all(
      inputorgs.map(async orgname => {
        console.log("getting org " + orgname);
        var org = await getOrg(login, orgname);
        if (org.body.total_results > 0) {
          scrapeResult[orgname] = {};
          var spaces = await getResourceAllPages(
            login,
            org.body.resources[0].entity.spaces_url
          );
          scrapeResult[orgname]["spaces"] = {};
          return await Promise.all(
            spaces.map(async space => {
              scrapeResult[orgname]["spaces"][space.entity.name] = {};
              var apps = await getResourceAllPages(
                login,
                space.entity.apps_url
              );
              scrapeResult[orgname]["spaces"][space.entity.name]["apps"] = {};
              return await Promise.all(
                apps.map(async app => {
                  scrapeResult[orgname]["spaces"][space.entity.name]["apps"][
                    app.entity.name
                  ] = {};
                  var bindings = await getResourceAllPages(
                    login,
                    app.entity.service_bindings_url
                  );

                  scrapeResult[orgname]["spaces"][space.entity.name]["apps"][
                    app.entity.name
                  ]["services"] = [];
                  return await Promise.all(
                    bindings.map(async binding => {
                      var instance = await getResource(
                        login,
                        binding.entity.service_instance_url
                      );
                      if (
                        instance.body.entity.type === "managed_service_instance"
                      ) {
                        var service = await getResource(
                          login,
                          instance.body.entity.service_url
                        );
                        scrapeResult[orgname]["spaces"][space.entity.name][
                          "apps"
                        ][app.entity.name]["services"].push(
                          service.body.entity.label
                        );
                      }
                    })
                  );
                })
              );
            })
          );
        }
      })
    );
    backupScrapeResult(() => uploadScrapeResult(scrapeResult));
  } catch (err) {
    console.error(err);
  }
}

schedule.scheduleJob(process.env.SYNC_SCHEDULE, function(fireDate) {
  console.log("cf-scraper run executing: " + fireDate);
  var params = {
    localFile: orgInputLocalFileLocation,
    s3Params: {
      Bucket: "input",
      Key: "input-orgs.json"
    }
  };
  var downloader = s3Client.downloadFile(params);
  downloader.on("error", function(err) {
    console.error("unable to download org input file:", err.stack);
  });
  downloader.on("progress", function() {
    console.log(
      "progress downloading org input file",
      downloader.progressAmount,
      downloader.progressTotal
    );
  });
  downloader.on("end", function() {
    console.log("done downloading org input file");
    scrape();
  });
});
