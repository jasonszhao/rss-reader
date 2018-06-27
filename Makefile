all: server js

js: 
	babel --source-maps --watch reader.jsx -o reader.js
server:
	node server.js

