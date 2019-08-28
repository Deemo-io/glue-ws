//GLUE.js server Copywrite(c) Zack Seliger 2019

const server = require('ws').Server;
const msgpack = require('msgpack-lite');

//this is for safely decoding messages. try/catch in case the message is invalid
function safelyParseMessage(message) {
	let parsed;
	try {
		parsed = msgpack.decode(new Uint8Array(message));
	}
	catch(e) {console.log(e);}
	return parsed;
}

//a room contains objects and clients. Objects and clients can be in more than
//one room. Clients conntected to a room get packets relating to the room
function Room(name) {
	this.name = name;
	this.clients = [];
	this.objects = [];
	this.props = new Map();
}

//Emits a packet to all clients. Should not be called directly, as it doesn't
//follow conventional api. Instead, call Server.emitTo normally, and if a string
//is passed, it will call this function
Room.prototype.emit = function(pack) {
	for (let i = 0; i < this.clients.length; i++) {
		this.clients[i].packetsToSend.push(pack);
	}
}

//This is the interface for setting a property of a room. Can be used for anything
Room.prototype.setProp = function(key, val) {
	this.props.set(key, val);
}

//The interface for getting a property of a room
Room.prototype.getProp = function(key) {
	return this.props.get(key);
}

//Server constructor.
//updateFPS: the FPS at which the world should be updated
//packetFPS: the FPS at which update packets should be sent to clients
function Server(options={ updateFPS: 60, packetFPS: 20 }) {
	this.ws = null;
	// this.clients = [];
	// this.objects = [];
	this.currId = 0;

	this.packetFunctions = new Map();
	this.rooms = new Map();

	//time stuff
	this.currTime = Date.now();
	this.prevTime = 0;
	this.dt = 0;
	this.realTime = 0;
	this.updateFPS = options.updateFPS;
	this.packetFPS = options.packetFPS
	this.updateTime = (1/this.updateFPS) * 1000;
	this.packetTime = (1/this.packetFPS) * 1000;

	//create the default room and keep it in a variable
	this.defaultRoomName = '*';
	this.rooms.set(this.defaultRoomName, new Room(this.defaultRoomName));
	this.defaultRoom = this.rooms.get(this.defaultRoomName);
}

//adds a listener to be called when a packet of type 'type' is received
Server.prototype.on = function(type, func) {
	if (this.packetFunctions.get(type) === undefined) {
		this.packetFunctions.set(type, []);
	}
	this.packetFunctions.get(type).push(func);
}

//queues message of type 'type' and data 'data' to be sent to all clients on next
//packetUpdate. To send packet to one client or room, look at 'emitTo()'
Server.prototype.emit = function(type, data) {
	const pack = {t: type, d: data};
	this.rooms.forEach((val, key) => {
		for (let i = 0; i < val.clients.length; i++) {
			val.clients[i].packetsToSend.push(pack);
		}
	});
}

// TODO: change to a socket.io-like 'to' function
//Queues message of type 'type' and data 'data' to be sent to specified target
//if the target is a room name, emit the packet to everyone in that room.
//else, assume it is a client queue the packet for that client
Server.prototype.emitTo = function(target, type, data) {
	const pack = {t: type, d: data};
	if (typeof target === 'string') {
		this.rooms.get(target).emit(pack);
	}
	else {
		target.packetsToSend.push(pack);
	}
}

//Creates a room with name 'name'. There can only be 1 room with the same name,
//and you cannot override the default room name
Server.prototype.createRoom = function(name) {
	if (name === this.defaultRoomName) {
		throw("cannot override the default room");
	}
	else {
		this.rooms.set(name, new Room(name));
		return this.rooms.get(name);
	}
}

//removes a room if one exists. Cannot destroy the default room
Server.prototype.deleteRoom = function(name) {
	if (name === this.defaultRoomName)
		throw("cannot delete the default room")
	else {
		// let room = this.rooms.delete(name);
		let room = this.rooms.get(name);
		//remove all of the objects and clients. Send clients to the default room ig
		while (room.objects.length > 0) this.removeObject(room.objects[0]);
		while (room.clients.length > 0) room.clients[i].join(this.defaultRoomName);

		//remove the
		this.rooms.delete(name);
	}
}

//adds an object to the server's world. Type and actual object don't have to be
//related, but is strongly recommended. After creating object, an 'a' packet
//is broadcast to all clients
Server.prototype.addObject = function(type, obj, roomName=this.defaultRoomName) {
	this.rooms.get(roomName).objects.push(obj);
	obj._roomName = roomName;
	obj.id = this.currId;
	obj.t = type;
	obj._getRoom = () => this.rooms.get(roomName);

	this.currId++;
	this.emitTo(roomName, "a", this._getAddPacket(obj));
	return obj;
}

//remove an object from the server's world, and send a packet of type 'r'
Server.prototype.removeObject = function(obj) {
	let index = this.rooms.get(obj._roomName).objects.indexOf(obj);
	this.emit("r", this._getRemovePacket(obj));

	if (index != -1) {
		this.rooms.get(obj._roomName).objects.splice(index, 1);
		//remove properties that we set like room name and id
		obj._roomName = undefined;
		obj.id = undefined;
		obj.t = undefined;
	}
}

//updates the world. Expects 'update()' to be a function inside of every object
Server.prototype.update = function() {
	//calculate how much time has elapsed and normalize it in this.dt
	this.currTime = Date.now();
	this.realTime = this.currTime - this.prevTime;
	this.dt = this.realTime / this.updateTime;
	this.prevTime = this.currTime;

	//update all objects, remove the ones that have dead === true
	this.rooms.forEach((val, key) => {
		for (let i = 0; i < val.objects.length; i++) {
			val.objects[i].update(this.dt);
			if (val.objects[i] != undefined && val.objects[i].dead === true) {
				this.removeObject(val.objects[i]);
				i--;
			}
		}

		//after updating every object in this room, call 'onRoomUpdate' if defined
		if (this.onRoomUpdate) {
			this.onRoomUpdate(val, val.name);
		}
	});

	//schedule next call to update
	let endTime = Date.now();
	if (endTime - this.currTime < this.updateTime) {
		setTimeout(this.update.bind(this), this.updateTime - (endTime - this.currTime));
	}
	else {
		setImmediate(this.update.bind(this));
	}
}

//sends update packets to clients
Server.prototype.packetUpdate = function() {
	const startTime = Date.now();

	this.rooms.forEach((val, key) => {
		const objs = [];
		for (let i = 0; i < val.objects.length; i++) {
			const pack = this._getUpdatePacket(val.objects[i]);
			// val.objects[i].update(this.dt);
			if (pack !== undefined)
				objs.push(pack);
		}
		if (objs.length > 0)
			this.emitTo(key, 'u', objs);
	});
	// let objs = [];
	// for (let i = 0; i < this.defaultRoom.objects.length; i++) {
	// 	const pack = this._getUpdatePacket(this.defaultRoom.objects[i]);
	// 	if (pack !== undefined)
	// 		objs.push(pack);
	// }
	// if (objs.length > 0)
	// 	this.emit("u", objs);

	//send packets to clients that have awaiting packets
	this.rooms.forEach((val, key) => {
		for (let i = 0; i < val.clients.length; i++) {
			if (val.clients[i].readyState === 1 && val.clients[i].packetsToSend.length > 0) {
				let frame = val.clients[i].packetsToSend;
				val.clients[i].send(msgpack.encode(frame), true);
				val.clients[i].packetsToSend = [];
			}
		}
	})
	// for (let i = 0; i < this.clients.length; i++) {
	// 	if (this.clients[i].readyState === 1 && this.clients[i].packetsToSend.length > 0) {
	// 		let frame = this.clients[i].packetsToSend;
	// 		this.clients[i].send(msgpack.encode(frame), true);
	// 		this.clients[i].packetsToSend = [];
	// 	}
	// }

	//schedule next call
	const endTime = Date.now();
	if (endTime - startTime < this.packetTime) {
		setTimeout(this.packetUpdate.bind(this), this.packetTime - (endTime - startTime));
	}
	else {
		setImmediate(this.packetUpdate.bind(this));
	}
}

//creates an 'add' ('a') packet by calling 'obj.addPacket()'. If it doesn't
//exist, the default packet looks like {t: obj.t, id: obj.id, d: null}
Server.prototype._getAddPacket = function(obj) {
	let pack = {t: obj.t, id: obj.id, d: null};
	if (obj.addPacket !== undefined)
		pack.d = obj.addPacket();

	pack = this._roundFloatsInObj(pack);
	return pack;
}
//creates a 'remove' ('r') packet by calling 'obj.removePacket()'. If it doesn't
//exist, the default packet looks like {t: obj.t, id: obj.id, d: null}
Server.prototype._getRemovePacket = function(obj) {
	let pack = {t: obj.t, id: obj.id, d: null};
	if (obj.removePacket !== undefined)
		pack.d = obj.removePacket();

	pack.d = this._roundFloatsInObj(pack.d);
	return pack;
}
//creates an 'update' ('u') packet by calling 'obj.updatePacket()'. If it doesn't
//exist, it will not send a packet to the clients
Server.prototype._getUpdatePacket = function(obj) {
	let pack = {t: obj.t, id: obj.id, d: null};
	if (obj.updatePacket !== undefined) {
		pack.d = obj.updatePacket();
  	pack.d = this._roundFloatsInObj(pack.d);
  	return pack;
  }
  return undefined;
}

//goes through every key inside of 'pack' and truncates to the hundredths (eg 1.01)
Server.prototype._roundFloatsInObj = function(pack) {
	for (let key in pack) {
		if (Number(pack[key]) === pack[key] && pack[key] % 1 !== 0) {
			pack[key] = Math.floor(pack[key] * 100);
			pack[key] /= 100;
		}
	}
	return pack;
}

//start listening for websocket connections on the specified port
Server.prototype.start = function(port=8443) {
	this.update();
	this.packetUpdate();

	//setup websocket server
	this.ws = new server({port: port});

	//on receiving a new connection event. Adds properties to ws as needed and
	//sends all server objects to that client so that they are up-to-speed on the
	//world
	this.ws.on('connection', (ws, req) => {
		ws.packetsToSend = [];
		this.defaultRoom.clients.push(ws);
		ws._roomName = this.defaultRoomName;
		for (let i = 0; i < this.defaultRoom.objects.length; i++) {
			this.emitTo(ws, "a", this._getAddPacket(this.defaultRoom.objects[i]));
		}
		if (this.onConnect) this.onConnect(ws, req);

		//function for joining a room. Will look for a room with the name 'roomName'
		//client can only be in one room at a time, so they will be removed from their
		//previous room
		ws.join = (roomName) => {
			//remove from previous room
			const index = this.rooms.get(ws._roomName).clients.indexOf(ws);
			if (index !== -1) this.rooms.get(ws._roomName).clients.splice(index, 1);

			//have to send remove packets for all objects in prev room
			for (let i = 0; i < this.rooms.get(ws._roomName).objects.length; i++) {
				this.emitTo(ws, 'r', this._getRemovePacket(this.rooms.get(ws._roomName).objects[i]));
			}

			//add to new room
			if (this.rooms.get(roomName)) {
				this.rooms.get(roomName).clients.push(ws);
				ws._roomName = roomName;

				//send add packets for all the objects in the room
				for (let i = 0; i < this.rooms.get(roomName).objects.length; i++) {
					this.emitTo(ws, 'a', this._getAddPacket(this.rooms.get(roomName).objects[i]));
				}
			}
		}

		//returns the room name that the socket is currently in
		ws.getRoomName = () => {
			return ws._roomName;
		}

		//on receiving a message. Parses the message and
		ws.on('message', (m) => {
			let messages = safelyParseMessage(m);
			for (let i = 0; i < messages.length; i++) {
				let funcArr = this.packetFunctions.get(messages[i].t);
				if (funcArr === undefined) funcArr = []; //error-catching, in case 't'
																								 //doesn't have any listeners
				for (let i = 0; i < funcArr.length; i++) {
					funcArr[i](messages[i].d, ws);
				}
			}
		});
		//on close event, splices 'ws' from 'this.clients'
		ws.on('close', () => {
			if (this.onDisconnect) this.onDisconnect(ws);//call user-defined function

			//splice from clients array in room
			let index = this.rooms.get(ws._roomName).clients.indexOf(ws);
			if (index !== -1) {
				this.rooms.get(ws._roomName).clients.splice(index, 1);
			}

			// let index = this.clients.indexOf(ws);
			// if (index !== -1) {
			// 	this.clients.splice(index, 1);
			// }

			ws.terminate();
		});
	});
}

//empty functions that are called for different events. Should be redefined by
//user
//'onConnect' is called when a client connects to server
//'onDisconnect' is called when a client disconnects from the server
//'onRoomUpdate' is called after updating a room. The room and roomName is made available
Server.prototype.onConnect = function(socket) {}
Server.prototype.onDisconnect = function(socket) {}
Server.prototype.onRoomUpdate = function(room, roomName) {}

//export the server
module.exports = { Server };
