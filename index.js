const schedule = require("node-schedule");
const cfenv = require("cfenv");
const superagent = require("superagent");
const s3 = require("s3-client");
const orgInputLocalFileLocation = "/home/vcap/tmp/input-orgs.json";
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

async function scrape() {
  try {
    console.log("getting api info on " + apiUrl);
    const info = await superagent.get(apiUrl + "/v2/info");
    console.log(
      "logging in using endpoint: " + info.body.authorization_endpoint
    );
    const login = await superagent
      .post(info.body.authorization_endpoint + "/oauth/token")
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
    console.log("token received");
    console.log(
      "reading org input file from local disk " + orgInputLocalFileLocation
    );
    let rawinputorgs = fs.readFileSync(orgInputLocalFileLocation);
    let inputorgs = JSON.parse(rawinputorgs);
    console.log("org input file loaded");
    inputorgs.forEach(async org => {
      var orgdata = await superagent
        .get(apiUrl + "/v2/organizations")
        .set("Authorization", "Bearer " + login.body.access_token)
        .set("Accept", "application/json")
        .query({ q: "name:" + org });
      console.log(JSON.stringify(orgdata.body));
    });
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
