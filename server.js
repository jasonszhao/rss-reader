const util = require("util");

const express = require("express");
const axios = require("axios");
const FeedParser = require("feedparser");

const app = express();

async function fetch(feed) {
  const res = await axios.get(feed, {
    timeout: 10000,
    responseType: "stream",

    // Some feeds do not respond without user-agent and accept headers.
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.63 Safari/537.36",
      accept: "text/html,application/xhtml+xml"
    }
  });

  const result = { articles: [] };

  return new Promise((resolve, reject) => {
    res.data
      .pipe(new FeedParser())
      .on("error", e => {
        console.log(
          "This is the response data: ",
          typeof res.data,
          util.inspect(res.data, { depth: 5 })
        ),
          result;
        throw Error(e);
      })
      .on("meta", meta => (result.meta = meta))
      
      // we use a normal function here, because we need to access `this`
      // arrow functions don't provide a `this` binding
      .on("readable", function() {
        let article;
        while ((article = this.read())) {
          result.articles.push(article);
        }
      })
      .on("end", () => resolve(result));
  });
}
app.get(
  "/api/rssparser",

  (req, res) =>
    fetch(req.query.url)
      .then(parsed => res.json(parsed))
      .catch(e => {
        console.log(e),
          res.status(500).json({
            error: "Could not get or parse feed.",
            url: req.query.url
          });
      })
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on localhost:${port}`));
