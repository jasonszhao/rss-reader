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


export {forwardTo, filter}
