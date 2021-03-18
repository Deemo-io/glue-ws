//GLUE.js server Copywrite(c) Zack Seliger 2019

const server = require('ws').Server;
const msgpack = require('msgpack-lite');

//this is for safely decoding messages. try/catch in case the message is invalid
function _safelyParseMessage(message) {
  let parsed;
  try {
    parsed = msgpack.decode(new Uint8Array(message));
  }
  catch(e) {console.log(e);}
  return parsed;
}

//goes through every key inside of 'pack' and truncates to the hundredths (eg 1.01)
function _roundFloatsInObj(pack) {
  for (let key in pack) {
    if (Number(pack[key]) === pack[key] && pack[key] % 1 !== 0) {
      pack[key] = Math.floor(pack[key] * 100);
      pack[key] /= 100;
    }
  }
  return pack;
}

//creates an 'add' ('a') packet by calling 'obj.addPacket()'. If it doesn't
//exist, the default packet looks like {t: obj.t, id: obj.id, d: null}
function _getAddPacket(obj) {
  let pack = {t: obj.t, id: obj.id, d: null};
  if (obj.addPacket !== undefined)
    pack.d = obj.addPacket();

  pack = _roundFloatsInObj(pack);
  return pack;
}
//creates a 'remove' ('r') packet by calling 'obj.removePacket()'. If it doesn't
//exist, the default packet looks like {t: obj.t, id: obj.id, d: null}
function _getRemovePacket(obj) {
  let pack = {t: obj.t, id: obj.id, d: null};
  if (obj.removePacket !== undefined)
    pack.d = obj.removePacket();

  pack.d = _roundFloatsInObj(pack.d);
  return pack;
}
//creates an 'update' ('u') packet by calling 'obj.updatePacket()'. If it doesn't
//exist, it will not send a packet to the clients
function _getUpdatePacket(obj) {
  let pack = {t: obj.t, id: obj.id, d: null};
  if (obj.updatePacket !== undefined) {
    pack.d = obj.updatePacket();
    pack.d = _roundFloatsInObj(pack.d);
    return pack;
  }
  return undefined;
}

//a room contains objects and clients. Objects can be in more than one room
//but clients can't. Clients conntected to a room get packets relating to the room
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

//Removes a client from the room, sending the remove packets for each object in the room
Room.prototype.removeClient = function(client) {
  //remove from the client list
  if (this.clients.indexOf(client) !== -1) this.clients.splice(this.clients.indexOf(client), 1);

  //have to send remove packets for all objects in room
  for (let i = 0; i < this.objects.length; i++) {
    client.packetsToSend.push({t: 'r', d: _getRemovePacket(this.objects[i])});
  }
}

//Add a client to the room, sending the add packets for each object in the room
Room.prototype.addClient = function(client) {
  // this.rooms.get(roomName).clients.push(ws);
  this.clients.push(client);
  client._roomName = this.name;

  //send add packets for all the objects in the room
  for (let i = 0; i < this.objects.length; i++) {
    client.packetsToSend.push({t: 'a', d: _getAddPacket(this.objects[i])});
  }
}

//Server constructor.
//updateFPS: the FPS at which the world should be updated
//packetFPS: the FPS at which update packets should be sent to clients
function Server(options={ updateFPS: 60, packetFPS: 20 }) {
  this.ws = null;
  this.currId = 0;
  this.ids = new Map();

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
  this.pingTimer = 0;//keeps track of cumulative time since pinging everyone

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
    let room = this.rooms.get(name);
    //remove all of the objects and clients. Send clients to the default room ig
    while (room.objects.length > 0) {
      this.removeObject(room.objects[0]);
    }
    while (room.clients.length > 0) room.clients[i].join(this.defaultRoomName);

    //remove the room
    this.rooms.delete(name);
  }
}

//adds an object to the server's world. Type and actual object don't have to be
//related, but is strongly recommended. After creating object, an 'a' packet
//is broadcast to all clients
Server.prototype.addObject = function(type, obj, roomName=this.defaultRoomName) {
  //if the object is already in another room, remove it from the other room
  if (obj._roomName) this.removeObject(obj);

  //make sure the id at currId isn't taken
  while (this.ids.get(this.currId) === true) {
    this.currId++;
  }

  //add the object to the new room
  this.rooms.get(roomName).objects.push(obj);
  obj._roomName = roomName;
  obj.id = this.currId;
  obj.t = type;
  obj._getRoom = () => this.rooms.get(roomName);

  //mark id as taken
  this.ids.set(this.currId, true);

  this.currId++;
  this.emitTo(roomName, 'a', _getAddPacket(obj));
  return obj;
}

//remove an object from the server's world, and send a packet of type 'r'
Server.prototype.removeObject = function(obj) {
  let room = this.rooms.get(obj._roomName);
  if (!room) return;

  this.emitTo(room.name, 'r', _getRemovePacket(obj));

  //free up the id and set currId to the smallest of the two
  this.ids.delete(obj.id);
  if (obj.id < this.currId) this.currId = obj.id;

  //remove the object from the room
  room.objects.splice(room.objects.indexOf(obj), 1);
  //remove properties that we set like room name and id
  obj._roomName = undefined;
  obj.id = undefined;
}

//updates the world. Expects 'update()' to be a function inside of every object
Server.prototype.update = function() {
  //calculate how much time has elapsed and normalize it in this.dt
  this.currTime = Date.now();
  this.realTime = this.currTime - this.prevTime;
  this.dt = this.realTime / this.updateTime;
  this.prevTime = this.currTime;

  //pings clients every 30 seconds to make sure they're still there
  this.pingTimer += this.realTime;
  if (this.pingTimer >= 30000) {
    this.rooms.forEach((room) => {
      for (let i = 0; i < room.clients.length; i++) {
        room.clients[i].ping();
      }
    });
    this.pingTimer = 0;
  }

  //update all objects, remove the ones that have dead === true
  this.rooms.forEach((room, key) => {
    for (let i = 0; i < room.objects.length; i++) {
      if (room.objects[i].update) room.objects[i].update(this.dt);
      if (room.objects[i] != undefined && room.objects[i].dead === true) {
        this.removeObject(room.objects[i]);
        i--;
      }
    }

    if (room.update) {
      room.update();
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

  this.rooms.forEach((room, key) => {
    const objs = [];
    for (let i = 0; i < room.objects.length; i++) {
      const pack = _getUpdatePacket(room.objects[i]);
      if (pack !== undefined && pack.d && Object.keys(pack.d).length !== 0)
        objs.push(pack);
    }
    if (objs.length > 0)
      this.emitTo(key, 'u', objs);
  });

  //send packets to clients that have awaiting packets
  this.rooms.forEach((room, key) => {
    for (let i = 0; i < room.clients.length; i++) {
      if (room.clients[i].readyState === 1 && room.clients[i].packetsToSend.length > 0) {
        let frame = room.clients[i].packetsToSend;
        room.clients[i].send(msgpack.encode(frame), true);
        room.clients[i].packetsToSend = [];
      }
    }
  })

  //schedule next call
  const endTime = Date.now();
  if (endTime - startTime < this.packetTime) {
    setTimeout(this.packetUpdate.bind(this), this.packetTime - (endTime - startTime));
  }
  else {
    setImmediate(this.packetUpdate.bind(this));
  }
}

//start listening for websocket connections on the specified port
Server.prototype.start = function(options={}) {
  this.update();
  this.packetUpdate();

  //setup websocket server
  this.ws = new server(options);

  //maybe you want to do something here
  //gets called before sending upgrade header back to client
  //invoked before 'connection' event
  this.ws.on('headers', (headers) => {
    if (this.onHeaders) this.onHeaders(headers);
  });

  //on receiving a new connection event. Adds properties to ws as needed and
  //sends all server objects to that client so that they are up-to-speed on the
  //world
  this.ws.on('connection', (ws, req) => {
    if (this.onConnect) this.onConnect(ws, req);

    //function for joining a room. Will look for a room with the name 'roomName'
    //client can only be in one room at a time, so they will be removed from their
    //previous room
    ws.join = (roomName) => {
      //remove from previous room
      let oldRoom = this.rooms.get(ws._roomName);
      let newRoom = this.rooms.get(roomName);

      //deal with removing old objects from the old room for the client (if old room exists)
      if (oldRoom !== undefined) {
        oldRoom.removeClient(ws);
      }

      //add to new room
      if (newRoom !== undefined) {
        newRoom.addClient(ws);
      }
    }

    //Packets get queued here before sending
    ws.packetsToSend = [];

    //returns the room name that the socket is currently in
    ws.getRoomName = () => {
      return ws._roomName;
    }

    //Sockets start out in the default room
    ws.join(this.defaultRoomName);

    //on receiving a message. Parses the message and
    ws.on('message', (m) => {
      let messages = _safelyParseMessage(m);
      for (let i = 0; i < messages.length; i++) {
        let funcArr = this.packetFunctions.get(messages[i].t);
        if (funcArr === undefined) funcArr = []; //error-catching, in case 't'
                                                 //doesn't have any listeners
        for (let j = 0; j < funcArr.length; j++) {
          funcArr[j](messages[i].d, ws);
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

      ws.terminate();
    });
  });
}

//empty functions that are called for different events. Should be redefined by
//user
//'onConnect' is called when a client connects to server
//'onDisconnect' is called when a client disconnects from the server
Server.prototype.onConnect = null;//function(socket) {}
Server.prototype.onDisconnect = null;//function(socket) {}

//export the server
module.exports = { Server };