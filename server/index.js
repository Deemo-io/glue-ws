//GLUE.js server
exports.Server = function(options={updateFPS: 60, packetFPS: 20}) {
var server = require('uws').Server;
var msgpack = require("msgpack-lite");

var GLUE = {wss: null, clients: [], objects: [], id: 0, packetFunctions: new Map()};
GLUE.currTime = Date.now();
GLUE.prevTime = 0;
GLUE.dt = 0;
GLUE.realTime = 0;
GLUE.updateFPS = options.updateFPS;
GLUE.packetFPS = options.packetFPS;
GLUE.updateTime = (1/GLUE.updateFPS) * 1000;
GLUE.packetTime = (1/GLUE.packetFPS) * 1000;

function safelyParseJSON(message) {
	var parsed;
	
	try {
		parsed = msgpack.decode( new Uint8Array(message));
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
	GLUE.currTime = Date.now();
	GLUE.realTime = GLUE.currTime - GLUE.prevTime;
	GLUE.dt = GLUE.realTime / GLUE.updateTime;
	GLUE.prevTime = GLUE.currTime;
	
	for (var i = 0; i < GLUE.objects.length; i++) {
		GLUE.objects[i].update(GLUE.dt);
		if (GLUE.objects[i] != undefined && GLUE.objects[i].dead !== undefined && GLUE.objects[i].dead === true) {
			GLUE.remove(GLUE.objects[i]);
			i--;
		}
	}
}

GLUE.packetUpdate = function() {
	var objs = [];
	for (var i = 0; i < GLUE.objects.length; i++) {
		var pack = GLUE.getUpdatePacket(GLUE.objects[i]);
		if (pack !== undefined)
			objs.push(pack);
	}
	if (objs.length > 0)
		GLUE.sendPacket("u", objs);
	
	for (var i = 0; i < GLUE.clients.length; i++) {
		if (GLUE.clients[i].readyState == 1 && GLUE.clients[i].packetsToSend.length > 0) {
			var frame = GLUE.clients[i].packetsToSend;
			GLUE.clients[i].send(msgpack.encode(frame));
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
	else
		return undefined;
	
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

GLUE.start = function(port=8443) {
	GLUE.wss = new server({port: port});
	setInterval(GLUE.update, GLUE.updateTime);
	setInterval(GLUE.packetUpdate, GLUE.packetTime);
	console.log("GLUE listening on port "+port+"...");
	
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
return GLUE;
}