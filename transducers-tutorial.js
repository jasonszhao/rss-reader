

if (!require)
  window.require = () => {}


const assert = chai.assert;
////

const is_even = x => x % 2 === 0
const test = is_even

//implementing filter, map

//filter

const filter = R.uncurryN(2, test => 
  R.reduce
    ( R.flip
	(R.uncurryN(2, el => test(el) ? R.append(el) : R.identity))
    , []
    )
)


filter(is_even)([1,2,3,4,5])

assert.deepEqual
  ( filter(is_even)([1,2,3,4,5])
  , [2,4]
  )

assert.deepEqual
  ( filter(is_even, [1,2,3,4,5])
  , [2,4]
  )

const map = R.uncurryN(2, fn => 
  R.reduce
      ( (accu, el) => R.append(test(el), accu)
      , []
      )
)


assert.deepEqual
  ( map(is_even)([1,2,3,4,5])
  , [false, true, false, true, false]
  )

assert.deepEqual
  ( map(is_even, [1,2,3,4,5])
  , [false, true, false, true, false]
  )

