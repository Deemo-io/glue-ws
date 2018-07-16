//GLUE.js client
var GlueClient = function() {
var GLUE = {ws: null, frames: [], frameTimes: [], currentTime: 0, prevTime: 0, dt: 0, instances: [], classes: new Map(), packetFunctions: new Map(), objects: [], packetsToSend: [], time: 0};
GLUE.updateTime = (1/60)*1000;

GLUE.init = function(ip) {
	GLUE.ws = new WebSocket(ip);
	GLUE.addPacketFunction("u", GLUE.updateObjects);
	GLUE.addPacketFunction("a", GLUE.addObject);
	GLUE.addPacketFunction("r", GLUE.removeObject);
	
	GLUE.ws.onopen = function() {
		
	}
	GLUE.ws.onmessage = function(message) {
		var data = JSON.parse(message.data);
		
		if (GLUE.frames.length < 1) {
			GLUE.executeFrame(data.m);
		}
		GLUE.frames.push(data.m);
		GLUE.frameTimes.push(data.t);
	}
}

GLUE.executeFrame = function(messages) {
	for (var i = 0; i < messages.length; i++) {
		var func = GLUE.packetFunctions.get(messages[i].t);
		if (func !== undefined)
			func(messages[i].d);
		else
			console.log("Packet function for " + messages[i].t + " is undefined");
	}
}

GLUE.update = function() {
	GLUE.prevTime = GLUE.currentTime;
	GLUE.currentTime = Date.now();
	GLUE.dt = (GLUE.currentTime-GLUE.prevTime) / GLUE.updateTime;
	
	if (GLUE.packetsToSend.length > 0 && GLUE.ws.readyState == 1) {
		GLUE.ws.send(JSON.stringify(GLUE.packetsToSend));
		GLUE.packetsToSend = [];
	}
	
	if (GLUE.frameTimes[0] == undefined || GLUE.frameTimes[1] == undefined)
		return;
	
	var tick = (GLUE.currentTime - GLUE.prevTime) * GLUE.dt / (GLUE.frameTimes[1] - GLUE.frameTimes[0]);
	GLUE.time += tick;
	
	if (GLUE.time >= 1.0) {
		while (GLUE.frameTimes.length > 2) {
			//advance to next frame
			GLUE.frames.splice(0, 1);
			GLUE.frameTimes.splice(0, 1);
			GLUE.time -= 1.0;
			//execute all of next frame's functions
			GLUE.executeFrame(GLUE.frames[0]);
		}
	}
	if (GLUE.time > 1.5) GLUE.time = 1;
}

GLUE.sendPacket = function(type, pack) {
	pack.t = type;
	GLUE.packetsToSend.push(pack);
}

GLUE.lerp = function(val1, val2) {
	return (val2-val1)*GLUE.time + val1;
}

GLUE.addPacketFunction = function(type, func) {
	if (GLUE.packetFunctions.get(type) != undefined) {
		console.log("packet function type " + type + " already in use.");
		return;
	}
	GLUE.packetFunctions.set(type, func);
}

GLUE.getObjectFromID = function(id) {
	for (var i = 0; i < GLUE.objects.length; i++) {
		if (GLUE.object[i].id == id) {
			return GLUE.objects[i];
		}
	}
	return -1;
}
GLUE.getObjectIndexFromID = function(id) {
	for (var i = 0; i < GLUE.objects.length; i++) {
		if (GLUE.objects[i].id == id) {
			return i;
		}
	}
	return -1;
}

GLUE.getInstanceFromID = function(id) {
	for (var i = 0; i < GLUE.instances.length; i++) {
		if (GLUE.instances[i].netObj.id == id) {
			return GLUE.instances[i];
		}
	}
	return -1;
}
GLUE.getInstanceIndexFromID = function(id) {
	for (var i = 0; i < GLUE.instances.length; i++) {
		if (GLUE.instances[i].netObj.id == id) {
			return i;
		}
	}
	return -1;
}

GLUE.addObject = function(pack) {
	GLUE.objects.push(pack);
	if (GLUE.classes.get(pack.t) != undefined) {
		GLUE.instances.push(new (GLUE.classes.get(pack.t))());
		GLUE.instances[GLUE.instances.length - 1].oldNetObj = pack;
		GLUE.instances[GLUE.instances.length - 1].netObj = pack;
	}
}

GLUE.removeObject = function(pack) {
	var index = GLUE.getObjectIndexFromID(pack.id);
	if (index != -1) {
		GLUE.objects.splice(index, 1);
		
		var index2 = GLUE.getInstanceIndexFromID(pack.id);
		if (index2 != -1) {
			GLUE.instances.splice(index2, 1);
		}
	}
}

GLUE.updateObjects = function(pack) {
	for (var i = 0; i < pack.length; i++) {
		var index = GLUE.getObjectIndexFromID(pack[i].id);
		if (index != -1) {
			GLUE.objects[index] = pack[i];
			
			var index2 = GLUE.getInstanceIndexFromID(pack[i].id);
			if (index2 != -1) {
				GLUE.instances[index2].oldNetObj = GLUE.instances[index2].netObj;
				GLUE.instances[index2].netObj = pack[i];
			}
		}
	}
}

GLUE.defineObject = function(type, cl) {
	GLUE.classes.set(type, cl);
}

return GLUE;
}