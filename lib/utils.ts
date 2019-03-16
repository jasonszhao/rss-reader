import flyd from 'flyd'

// copy-pasted from 
// https://github.com/paldepind/flyd/blob/master/module/forwardto/index.js
const forwardTo = flyd.curryN(2, function(targ, fn) {
  var s = flyd.stream();
  flyd.map(function(v) { targ(fn(v)); }, s);
  return s;
});

// copy-pasted from
// https://github.com/paldepind/flyd/blob/master/module/filter/index.js
const filter = flyd.curryN(2, function(fn, s) {
  return flyd.combine(function(s, self) {
    if (fn(s())) self(s.val);
  }, [s]);
});


/***** Some "functional" utilities ****/

//console.logs args and returns the last one
//This can be a bottleneck if we're logging ~1000 items at once. 
//How do I know? I've tested this function with and without side effects
//With log: lag with a few seconds. Without console.log: instantaneous
const DEBUG = true

const log = (...args: any[]) => 
    ( DEBUG ? console.log.apply(console, args) : null
    , args[args.length - 1]
    )

const uuid = () => (Math.random()+1).toString(36).slice(2) 


export {DEBUG, forwardTo, filter, log, uuid}
