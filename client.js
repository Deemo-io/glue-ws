//GLUE.js client Copywrite(c) Zack Seliger 2019

const __requestFrame = ( window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame ||
  window.oRequestAnimationFrame || window.msRequestAnimationFrame ||
  function(callback) {
    window.setTimeout(callback, 1000 / 60);
  });

function GlueClient() {
  this.ws = null;
  this.packetsToSend = [];

  this.instances = new Map();
  this.objects = new Map();

  this.classLinks = new Map();
  this.packetFunctions = new Map();

  //time stuff
  this.updateTime = (1/60)*1000;
  this.currentTime = 0;
  this.prevTime = 0;
  this.dt = 0;
}

//connect to target ip and initialize options and functions relating to ws
GlueClient.prototype.connect = function(ip) {
  this.ws = new WebSocket(ip);
  this.ws.binaryType = "arraybuffer";

  //upon receiving messages, will decode and execute them. messages is an array
  //of packets
  this.ws.onmessage = (message) => {
    var data = msgpack.decode(new Uint8Array(message.data));

    this.executeFrame(data);
  }

  //update packet function
  //loops through all update information in 'pack' and updates the GLUE objects
  //and then updates the netObj of the instance of each object, setting
  //'oldNetObj' to the previous packet. Also calls 'onUpdate' if defined
  this.on("u", (pack) => {
    for (var i = 0; i < pack.length; i++) {
      this.objects.set(pack[i].id, pack[i]);

      const instance = this.instances.get(pack[i].id);
      instance.oldNetObj = instance.netObj;
      instance.netObj = pack[i];

      if (instance.onUpdate !== undefined) {
        instance.onUpdate(pack[i].d);
      }
    }
  });
  //add packet function
  //this creates a new instance and net object for the class of type 'pack.t'
  //if onAdd is defined for the new instance, it calls the function
  this.on("a", (pack) => {
    // this.objects.push(pack);
    this.objects.set(pack.id, pack);
    if (this.classLinks.get(pack.t) != undefined) {
      let newInstance = new (this.classLinks.get(pack.t))()
      this.instances.set(pack.id, newInstance);
      newInstance.oldNetObj = pack;
      newInstance.netObj = pack;
      if (newInstance.onAdd !== undefined) {
        newInstance.onAdd(pack.d);
      }
    }
    else {
      console.warn("GLUE type undefined: "+pack.t);
    }
  });
  //remove packet function
  //calls 'onRemove' if defined and splices the instance and GLUE object
  //from their respective arrays
  this.on("r", (pack) => {
    if (this.instances.get(pack.id) && this.instances.get(pack.id).onRemove) {
      this.instances.get(pack.id).onRemove(pack.d);
    }

    this.instances.delete(pack.id);
    this.objects.delete(pack.id);
  });

  //kicks off the first call to update(), which calls itself subsequent times
  this.update();
}

//takes an array of messages and runs the listeners of type 't' found in
//packetFunctions
GlueClient.prototype.executeFrame = function(messages) {
  for (let i = 0; i < messages.length; i++) {
    let funcArr = this.packetFunctions.get(messages[i].t);
    if (funcArr === undefined) funcArr = []; //error-catching. Allows program
                                             //to continue if no listeners have been defined

    for (let j = 0; j < funcArr.length; j++) {
      funcArr[j](messages[i].d);
    }
  }
}

//calculates deltaTime, which is normalized, and sends any pending messages
//to the server. Should be called manually by the user on update
GlueClient.prototype.update = function() {
  this.prevTime = this.currentTime;
  this.currentTime = Date.now();
  this.dt = (this.currentTime-this.prevTime) / this.updateTime;

  if (this.packetsToSend.length > 0 && this.ws.readyState == 1) {
    this.ws.send(msgpack.encode(this.packetsToSend));
    this.packetsToSend = [];
  }

  __requestFrame(this.update.bind(this));
}

//queues a packet to be sent to the server. Packets have a type(t) and data(d)
GlueClient.prototype.emit = function(type, data={}) {
  let pack = {t: type, d: data};
  this.packetsToSend.push(pack);
}

//adds a listener to be called when a packet of type 'type' is received
GlueClient.prototype.on = function(type, func) {
  if (this.packetFunctions.get(type) === undefined) {
    this.packetFunctions.set(type, []);
  }
  this.packetFunctions.get(type).push(func);
}

//expects a type and a class. An instance of this class will be instantiated
//when the client received a message of type 'a' with the type 'type'
GlueClient.prototype.link = function(type, cl) {
  this.classLinks.set(type, cl);
}
