//assumes server is running at $PORT
const test = require('ava')
const Dredd = require('dredd');
const yaml = require('js-yaml');
const fs   = require('fs');
let port = process.env.port || 3000

//test('rssparser returns 200 status when given a valid feed', t => {
   //axios.get('localhost:3000/api/rssparser?url=https://news.ycombinator.com/rss')
     //.then(re 
//});

test.cb('api integration', t => {
  t.plan(1);

  //require('./server')

  const doc = yaml.safeLoad(fs.readFileSync('dredd.yml', 'utf8'), {json: true});
  const configuration = {
      server: "http://127.0.0.1:" + port,
      options: {
	path: ["apiary.apib"],
	sandbox: true,
	reporter: ["apiary"],
	custom: doc.custom
      }
  };
  const dredd = new Dredd(configuration);

  dredd.run(function (error, stats) {
    if(error) {
	console.log(error)
	t.fail(["Error: ", error])
    }
    else if (stats.failures > 0 || stats.errors > 0) {
      t.fail()
    }
    else {
	t.pass(stats) 
    }
    t.end()
  });
})

