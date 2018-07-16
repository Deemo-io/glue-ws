# glue-ws
Minimalistic framework for websocket applications
## Setup
glue-ws requires setup on both the server and the client.
### Server
After installing the npm module, this is the most basic code to set up a listening server
```
var glue = require("glue-ws");
var network = new glue.Server();
network.start(8443);

network.onConnect = function() {
	console.log("client has connected.");
}
network.onDisconnect = function() {
	console.log("client has disconnected");
}
```
### Client
The client for glue-ws can be found on the [github repository](https://github.com/Twist177/glue-ws). After including the client in your code you can set up a connection to a server running glue-ws with this code:
```
var client = new GlueClient();
client.init("127.0.0.1:8443");
```