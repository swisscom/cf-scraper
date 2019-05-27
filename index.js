const schedule = require("node-schedule");
console.log(
  "starting cf-scraper, scheduling job with schedule " +
    process.env.SYNC_SCHEDULE
);
schedule.scheduleJob(process.env.SYNC_SCHEDULE, function(fireDate) {
  console.log("cf-scraper run executing: " + fireDate);
});
