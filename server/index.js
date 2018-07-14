//GLUE.js server Copywrite(c) Zack Seliger 2018
var GLUE = {wss: null, clients: [], objects: [], id: 0, packetFunctions: new Map()};
var server = require('uws').Server;
//var msgpack = require("msgpack-lite");

var currTime = Date.now();
var prevTime = 0;
GLUE.dt = 0;
var updateFPS = 60;
var packetFPS = 20;
var updateTime = (1/updateFPS) * 1000;

function safelyParseJSON(message) {
	var parsed;
	
	try {
		parsed = JSON.parse(message);
	}
	catch(e) {
		
	}
	
	return parsed;
}

GLUE.addObject = function(type, obj) {
	obj.t = type;
	GLUE.objects.push(obj);
	obj.id = GLUE.id;
	GLUE.id++;
	GLUE.sendPacket("a", GLUE.getAddPacket(obj));
	return obj;
}
GLUE.removeObject = function(obj) {
	var index = GLUE.objects.indexOf(obj);
	if (index != -1)
		GLUE.objects.splice(index, 1);
	GLUE.sendPacket("r", GLUE.getRemovePacket(obj));
}

GLUE.update = function() {
	currTime = Date.now();
	GLUE.dt = (currTime - prevTime) / updateTime;
	prevTime = currTime;
	
	for (var i = 0; i < GLUE.objects.length; i++) {
		GLUE.objects[i].update(GLUE.dt);
		if (GLUE.objects[i].dead !== undefined && GLUE.objects[i].dead === true) {
			GLUE.remove(GLUE.objects[i]);
			i--;
		}
	}
}

GLUE.packetUpdate = function() {
	var objs = [];
	for (var i = 0; i < GLUE.objects.length; i++) {
		var pack = GLUE.getUpdatePacket(GLUE.objects[i]);
		if (Object.getOwnPropertyNames(pack).length > 0)
			objs.push(pack);
	}
	GLUE.sendPacket("u", objs);
	
	for (var i = 0; i < GLUE.clients.length; i++) {
		if (GLUE.clients[i].readyState == 1 && GLUE.clients[i].packetsToSend.length > 0) {
			var frame = {t: Date.now(), m: GLUE.clients[i].packetsToSend};
			GLUE.clients[i].send(JSON.stringify(frame));
			GLUE.clients[i].packetsToSend = [];
		}
	}
}

GLUE.sendPacket = function(type, data, client) {
	var pack = {t: type, d: data};
	if (client == undefined) {
		for (var i = 0; i < GLUE.clients.length; i++) {
			GLUE.clients[i].packetsToSend.push(pack);
		}
	}
	else {
		client.packetsToSend.push(pack);
	}
}

GLUE.addPacketFunction = function(type, func) {
	GLUE.packetFunctions.set(type, func);
}

GLUE.getAddPacket = function(obj) {
	var pack = {};
	if (obj.addPacket !== undefined)
		pack = obj.addPacket();
	
	pack = GLUE.roundFloatsInObj(pack);
	pack.id = obj.id;
	pack.t = obj.t;
	return pack;
}
GLUE.getRemovePacket = function(obj) {
	var pack = {};
	if (obj.removePacket !== undefined)
		pack = obj.removePacket();
	
	pack = GLUE.roundFloatsInObj(pack);
	pack.id = obj.id;
	pack.t = obj.t;
	return pack;
}
GLUE.getUpdatePacket = function(obj) {
	var pack = {};
	if (obj.updatePacket !== undefined)
		pack = obj.updatePacket();
	
	pack = GLUE.roundFloatsInObj(pack);
	pack.id = obj.id;
	pack.t = obj.t;
	return pack;
}

GLUE.roundFloatsInObj = function(pack) {
	for (var key in pack) {
		if (Number(pack[key]) === pack[key] && pack[key] % 1 !== 0) {
			pack[key] = Math.floor(pack[key] * 100);
			pack[key] /= 100;
		}
	}
	return pack;
}

GLUE.start = function(port=8080) {
	GLUE.wss = new server({port: port});
	setInterval(GLUE.update, (1/updateFPS)*1000);
	setInterval(GLUE.packetUpdate, (1/packetFPS)*1000);
	console.log("Listening on port "+port+"...");
	
	GLUE.wss.on('connection', function(ws) {
		ws.packetsToSend = [];
		GLUE.clients.push(ws);
		for (var i = 0; i < GLUE.objects.length; i++) {
			GLUE.sendPacket("a", GLUE.getAddPacket(GLUE.objects[i]), ws);
		}
		GLUE.onConnect(ws);
		
		ws.on('message', function(m) {
			var messages = safelyParseJSON(m);
			for (var i = 0; i < messages.length; i++) {
				var func = GLUE.packetFunctions.get(messages[i].t);
				func(messages[i], ws);
			}
		});
		ws.on('close', function() {
			GLUE.onDisconnect(ws);
			var index = GLUE.clients.indexOf(ws);
			if (index != -1)
				GLUE.clients.splice(index, 1);
			ws.terminate();
		});
	});
}

GLUE.onConnect = function(socket) {
	
}
GLUE.onDisconnect = function(socket) {
	
}

///////////////////////////////////////
///////////////GLUE END////////////////
///////////////////////////////////////

class Player {
	constructor(x,y) {
		this.controls = {};
		this.controls.left = false;
		this.controls.right = false;
		this.controls.up = false;
		this.controls.down = false;
		
		this.position = {};
		this.position.x = x || 0;
		this.position.y = y || 0;
		this.xVel = 0;
		this.yVel = 0;
		this.speed = 10;
	}
	update(dt) {
		if (this.controls.left) {
			this.xVel = -this.speed;
		}
		if (this.controls.right) {
			this.xVel = this.speed;
		}
		if (this.controls.up) {
			this.yVel = -this.speed;
		}
		if (this.controls.down) {
			this.yVel = this.speed;
		}
		
		this.position.x += this.xVel * dt;
		this.position.y += this.yVel * dt;
		this.xVel = 0;
		this.yVel = 0;
	}
	addPacket() {
		return {x: this.position.x, y: this.position.y};
	}
	updatePacket() {
		return {x: this.position.x, y: this.position.y, controls: this.controls};
	}
}

GLUE.start(8080);

GLUE.onConnect = function(socket) {
	socket.player = GLUE.addObject("p", new Player());
	GLUE.sendPacket("i", {id: socket.player.id}, socket);
}
GLUE.onDisconnect = function(socket) {
	GLUE.removeObject(socket.player);
}
GLUE.addPacketFunction("c", function(pack, ws) {
	ws.player.controls = pack;
});