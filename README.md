# cf-scraper
A simple app which scrapes information about Cloud Foundry orgs

## How to deploy

### Prepare the service instances
`cf-scraper` gets the credentials for accessing the Cloud Foundry API via a service of type `secret-store`. Furthermore, it gets the list input orgs from an S3 service instance and also writes the scrape output to that S3 service instance.

1. Create a user in your Cloud Foundry instance with the role `cloud_controller.global_auditor`.
````
uaac user add $AUDITOR_USER_NAME --emails $AUDITOR_EMAIL;
uaac member add cloud_controller.global_auditor $AUDITOR_USERNAME;
````
2. Create a secrets store called `cf-api-credentials`.
````
cf cs secrets-store json cf-api-credentials -c '{"username": "'$AUDITOR_USER_NAME'", "password": "'$AUDITOR_PASSWORD'"}'
````
3. Create an S3 service instance named `orgs-store`.
````
cf cs dynstrg-2 usage orgs-store
````

### Load the input orgs
The scraper uses a file called `input/input-orgs.json` in the `orgs-store` instance.

4. Prepare the file `input-orgs.json` to contain an array of org names.
````
[
  "org-1",
  "org-2",
  "org-3",
  ...,
  "org-n"
]
````

5. Upload the file to `orgs-store/input`, for example using [mc](https://github.com/minio/mc).

### Adapt the schedule
The scraper runs as a scheduled task. The schedule is defined as a cron expression in the environment variable `SYNC_SCHEDULE`. 

6. Open `manifest.yml` and set `SYNC_SCHEDULE` to the desired cron expression (e.g. `*/15 * * * *` for "at every 15th minute").

### Push the app
7. Everything else is self configuring. Just push the app.
````
cf push
````

## Collect the scrape result
The scraper uploads the result of a scrape run to `orgs-store/output/scrape-result.json`. Before starting the upload, a backup copy of the previous result is made called `scrape-result-backup.json`.

8. Download `orgs-store/output/scrape-result.json`, for example using [mc](https://github.com/minio/mc).

