all: server js

js: 
	rollup -c --watch --sourcemap

server:
	node server.js


