all: server js

watch: js-watch server-watch

js: 
	cd public && rollup -c --sourcemap
js-watch: 
	cd public && rollup -c --watch --sourcemap

server:
	node server.js
server-watch:
	nodemon server.js

