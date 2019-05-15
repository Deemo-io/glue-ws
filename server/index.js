//GLUE.js server
exports.Server = function(options={updateFPS: 60, packetFPS: 20}) {
	const server = require('ws').Server;
	const msgpack = require("msgpack-lite");

	let GLUE = {wss: null, clients: [], objects: [], id: 0, packetFunctions: new Map()};
	GLUE.currTime = Date.now();
	GLUE.prevTime = 0;
	GLUE.dt = 0;
	GLUE.realTime = 0;
	GLUE.updateFPS = options.updateFPS;
	GLUE.packetFPS = options.packetFPS;
	GLUE.updateTime = (1/GLUE.updateFPS) * 1000;
	GLUE.packetTime = (1/GLUE.packetFPS) * 1000;

	function safelyParseMessage(message) {
		var parsed;
		
		try {
			parsed = msgpack.decode(new Uint8Array(message));
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
		let index = GLUE.objects.indexOf(obj);
		if (index != -1)
			GLUE.objects.splice(index, 1);
		GLUE.sendPacket("r", GLUE.getRemovePacket(obj));
	}

	GLUE.update = function() {
		GLUE.currTime = Date.now();
		GLUE.realTime = GLUE.currTime - GLUE.prevTime;
		GLUE.dt = GLUE.realTime / GLUE.updateTime;
		GLUE.prevTime = GLUE.currTime;
		
		//update all objects, remove the ones we need to remove
		for (let i = 0; i < GLUE.objects.length; i++) {
			GLUE.objects[i].update(GLUE.dt);
			if (GLUE.objects[i] != undefined && GLUE.objects[i].dead !== undefined && GLUE.objects[i].dead === true) {
				GLUE.removeObject(GLUE.objects[i]);
				i--;
			}
		}
		
		//schedule next call to update
		let endTime = Date.now();
		if (endTime - GLUE.currTime < GLUE.updateTime) {
			setTimeout(GLUE.update, GLUE.updateTime - (endTime - GLUE.currTime));
		}
		else {
			setImmediate(GLUE.update);
		}
	}

	GLUE.packetUpdate = function() {
		let startTime = Date.now();
		let objs = [];
		for (let i = 0; i < GLUE.objects.length; i++) {
			const pack = GLUE.getUpdatePacket(GLUE.objects[i]);
			if (pack !== undefined)
				objs.push(pack);
		}
		if (objs.length > 0)
			GLUE.sendPacket("u", objs);
		
		//send packets to clients that have awaiting packets
		for (let i = 0; i < GLUE.clients.length; i++) {
			if (GLUE.clients[i].readyState === 1 && GLUE.clients[i].packetsToSend.length > 0) {
				let frame = GLUE.clients[i].packetsToSend;
				GLUE.clients[i].send(msgpack.encode(frame), true);
				GLUE.clients[i].packetsToSend = [];
			}
		}
		
		//schedule next call
		let endTime = Date.now();
		if (endTime - startTime < GLUE.packetTime) {
			setTimeout(GLUE.packetUpdate, GLUE.packetTime - (endTime - startTime));
		}
		else {
			setImmediate(GLUE.packetUpdate);
		}
	}

	GLUE.sendPacket = function(type, data, client) {
		const pack = {t: type, d: data};
		if (client == undefined) {
			for (let i = 0; i < GLUE.clients.length; i++) {
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
		let pack = {};
		if (obj.addPacket !== undefined)
			pack = obj.addPacket();
		
		pack = GLUE.roundFloatsInObj(pack);
		pack.id = obj.id;
		pack.t = obj.t;
		return pack;
	}
	GLUE.getRemovePacket = function(obj) {
		let pack = {};
		if (obj.removePacket !== undefined)
			pack = obj.removePacket();
		
		pack = GLUE.roundFloatsInObj(pack);
		pack.id = obj.id;
		pack.t = obj.t;
		return pack;
	}
	GLUE.getUpdatePacket = function(obj) {
		let pack = {};
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
		for (let key in pack) {
			if (Number(pack[key]) === pack[key] && pack[key] % 1 !== 0) {
				pack[key] = Math.floor(pack[key] * 100);
				pack[key] /= 100;
			}
		}
		return pack;
	}

	GLUE.start = function(port=8443) {
		GLUE.update();
		GLUE.packetUpdate();
		
		//setup websocket server
		GLUE.wss = new server({port: port});
		
		GLUE.wss.on('connection', function(ws) {
			ws.packetsToSend = [];
			GLUE.clients.push(ws);
			for (let i = 0; i < GLUE.objects.length; i++) {
				GLUE.sendPacket("a", GLUE.getAddPacket(GLUE.objects[i]), ws);
			}
			GLUE.onConnect(ws);
			
			ws.on('message', function(m) {
				let messages = safelyParseMessage(m);
				for (let i = 0; i < messages.length; i++) {
					let func = GLUE.packetFunctions.get(messages[i].t);
					if (func !== undefined)
						func(messages[i], ws);
					else
						console.log("Packet function for " + messages[i].t + " is undefined");
				}
			});
			ws.on('close', function() {
				GLUE.onDisconnect(ws);
				let index = GLUE.clients.indexOf(ws);
				if (index !== -1) {
					GLUE.clients.splice(index, 1);
				}
				ws.terminate();
			});
		});
		/*GLUE.app = new server().ws('/*', {
			idleTimeout: 1800,
			maxPayloadLength: 64 * 1024 * 1024,
			open: (socket) => {
				socket.packetsToSend = [];
				GLUE.clients.push(socket);
				for (let i = 0; i < GLUE.objects.length; i++) {
					GLUE.sendPacket("a", GLUE.getAddPacket(GLUE.objects[i]), socket);
				}
				GLUE.onConnect(socket);
			},
			message: (socket, message) => {
				let messages = safelyParseMessage(message);
				for (let i = 0; i < messages.length; i++) {
					let func = GLUE.packetFunctions.get(messages[i].t);
					if (func !== undefined)
						func(messages[i], socket);
					else
						console.log("Packet function for " + messages[i].t + " is undefined");
				}
			},
			drain: (socket) => {
				console.log("drain");
			},
			close: (socket) => {
				GLUE.onDisconnect(socket);
				let index = GLUE.clients.indexOf(socket);
				if (index != -1)
					GLUE.clients.splice(index, 1);
			}
		});
		
		//start listening on given port
		GLUE.app.listen(port, (token) => {
			if (token) {
				console.log("GLUE listening on port "+port+"...");
			}
			else {
				console.log("GLUE failed to listen on port "+port+"...");
			}
		});*/
	}

	GLUE.onConnect = function(socket) {
		
	}
	GLUE.onDisconnect = function(socket) {
		
	}
	return GLUE;
}