'use strict'

const browserEnv = require('browser-env')
browserEnv(['window', 'document', 'navigator'], {pretendToBeVisual: true})

document.body.appendChild(document.createElement('main'))

//suppress the console output
const real_console = console
const fake_console = {log: () => {}, info: () => {}, 
	warn: real_console.warn.bind(real_console)}

console = fake_console

const 
	{ init
	, initial_actions
	, model
	, update
	, render
	, reorder_feed_source } 
	= require("../dist/reader")

console = real_console





//const reader = require('./reader')

const chai = require('chai')
const mocha = require('mocha')

const assert = chai.assert

//mocha.setup('bdd')


describe('actions', () => {
    describe('REORDER_FEED_SOURCE', () => {
        const starting_model = () => init()

        it('should be able to move sources forwards', () => {
            const new_model = update(reorder_feed_source('gtieivvssvl', 0), starting_model())

            assert.equal(new_model.sources[0].id, 'gtieivvssvl')
            assert.equal(new_model.sources[1].id, 'm4nfqca9oz')
            assert.lengthOf(new_model.sources, 2)
        })

        it('should be able to move sources backwards', () => {
            const new_model = update(reorder_feed_source('m4nfqca9oz', 1), starting_model())

            assert.equal(new_model.sources[0].id, 'gtieivvssvl')
            assert.equal(new_model.sources[1].id, 'm4nfqca9oz')
            assert.lengthOf(new_model.sources, 2)
        }) 
        it('should be able to move keep sources in place', () => {
        
            const new_model = update(reorder_feed_source('m4nfqca9oz', 0), starting_model())

            assert.equal(new_model.sources[0].id, 'm4nfqca9oz')
            assert.equal(new_model.sources[1].id, 'gtieivvssvl')
            assert.lengthOf(new_model.sources, 2)
        }) 
        it('should put the source at the end of the list when target is too big', () => {
            const new_model = update(reorder_feed_source('m4nfqca9oz', 3), starting_model())

            assert.equal(new_model.sources[0].id, 'gtieivvssvl')
            assert.equal(new_model.sources[1].id, 'm4nfqca9oz')
            assert.lengthOf(new_model.sources, 2)
        
        })
    })
})

