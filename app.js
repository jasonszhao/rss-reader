"use strict";

/***** Some "functional" utilities ****/
const produce = immer.default.bind(immer)

const log = (...args) => (
  console.log.apply(console, args), args[args.length - 1]
);

const add = R.curry((b, a) => a + b)
const subtract = R.curry((b, a) => a - b)

const add1 = add(1)
const subtract1 = subtract(1)
//////// END functional utilities

// Model
const init = () => ({
  x: 0,
  y: 0,
})

const sum = flyd.combine(
  (model) => model.x + model.y
)

// Actions
const INCREMENT_X = 'increment_x';
const DECREMENT_X = 'decrement_x';
const INCREMENT_Y = 'increment_y';
const DECREMENT_Y = 'decrement_y';



function update(action, model) {
  switch (action) {
    case INCREMENT_X:
      return produce(model, d => {
	d.x += 1
      })
      //return {
      //x: model.x - 1,
      //y: model.y
      //}
    case DECREMENT_X:
      return {
	x: model.x - 1,
	y: model.y
      }
      break;
    case INCREMENT_Y:
      return {
	x: model.x,
	y: model.y + 1
      }
      break;
    case DECREMENT_Y:
      return {
	x: model.x,
	y: model.y - 1
      }
      break;
  }
}
const restoreState = () => {
  const restored = JSON.parse(localStorage.getItem('state'));
  return restored === null ? init() : restored;
};
const saveState = (model) => {
  localStorage.setItem('state', JSON.stringify(model));
};


// View
const $x = document.getElementById('x');
const $y = document.getElementById('y')
const $sum = document.getElementById('sum')

function render(model) {
  $x.textContent = model.x
  $y.textContent = model.y
  $sum.textContent = model.x + model.y;

  $x.style.backgroundColor = `hsl(${model.x * 10 % 360}, 100%, 50%)`;
  $y.style.backgroundColor = `hsl(${model.y * 10 % 360}, 100%, 50%)`;
  $sum.style.backgroundColor = `hsl(${(model.x + model.y) * 10 % 360}, 100%, 50%)`;
}


// Streams
const actions = flyd.stream();
const model = flyd.scan(R.flip(update), restoreState(), actions)
actions
  .map(log)
model
  .map(log)
  .map(render)

model
  .map(saveState)

