//globals
var GLUE = require('glue-ws').Server();
PLAYER_WIDTH = 15;
PLAYER_HEIGHT = 25;
//collections
players = [];
blocks = [];

function checkCollision(obj1, obj2) {
	if (obj1.width === undefined) {
		obj1.width = 1;
		obj1.height = 1;
	}
	if (obj2.width === undefined) {
		obj2.width = 1;
		obj2.height = 1;
	}

	return (obj1.x - obj1.width/2 < obj2.x + obj2.width/2 &&
			obj1.x + obj1.width/2 > obj2.x - obj2.width/2 &&
			obj1.y - obj1.height/2 < obj2.y + obj2.height/2 &&
			obj1.y + obj1.height/2 > obj2.y - obj2.height/2);
}

class Player {
	constructor(x, y) {
		this.x = x || 0;
		this.y = y || 0;
		this.xVel = 0;
		this.yVel = 0;
		this.width = PLAYER_WIDTH;
		this.height = PLAYER_HEIGHT;
		this.controls = {left: false, right: false, up: false, down: false};
		this.inputNumber = 0;
		this.speed = 3;
		this.canJump = false;
		this.upEnabled = false;
		this.numJumps = 0;
		this.maxJumps = 2;

		players.push(this);
	}
	update(dt) {
		var prevx = this.x;
		var prevy = this.y;

		this.xVel = 0;
		//get input/move on x axis
		if (this.controls.left) {
			this.xVel = -this.speed;
		}
		if (this.controls.right) {
			this.xVel = this.speed;
		}
		this.x += this.xVel * dt;
		//check for x axis collision
		for (var i = 0; i < blocks.length; i++) {
			if (checkCollision(this, blocks[i])) {
				this.x = prevx;
				break;
			}
		}

		//move on y axis
		if (this.canJump && this.upEnabled == true && this.controls.up) {
			this.yVel = -10;
			this.upEnabled = false;
			this.numJumps += 1;
			if (this.numJumps >= this.maxJumps)
				this.canJump = false;
		}
		if (!this.controls.up) {
			this.upEnabled = true;
		}
		this.yVel += 0.7;
		this.y += this.yVel * dt;
		//check for y axis collision
		for (var i = 0; i < blocks.length; i++) {
			if (checkCollision(this, blocks[i])) {
				if (this.yVel > 0) {
					this.canJump = true;
					this.numJumps = 0;
				}
				this.y = prevy;
				this.yVel = 0;
				break;
			}
		}

		//dying
		if (this.y > 1000) this.dead = true;
	}
	addPacket() {
		return {x: this.x, y: this.y, width: this.width, height: this.height};
	}
	updatePacket() {
		return {x: this.x, y: this.y, n: this.inputNumber};
	}
	/*removePacket() {
		var index = players.indexOf(this);
		if (index != -1) players.splice(index, 1);
	}*/
}

class Block {
	constructor(x, y, w, h) {
		this.x = x;
		this.y = y;
		this.width = w;
		this.height = h;
		blocks.push(this);
	}
	update() {}
	addPacket() {
		return {x: this.x, y: this.y, width: this.width, height: this.height};
	}
}

GLUE.onConnect = function(socket) {
	socket.player = GLUE.addObject("p", new Player(640,360));
	GLUE.sendPacket("i", {id: socket.player.id}, socket);
}
GLUE.onDisconnect = function(socket) {
	if (socket.player !== undefined) {
		GLUE.removeObject(socket.player);
	}
}

GLUE.addPacketFunction("c", function(pack, ws) {
	ws.player.controls = pack;
	ws.player.inputNumber += 1;
});

function main() {

}
setInterval(main, 50);//20 fps

GLUE.start(8080);
GLUE.addObject("b", new Block(640,720,1280,50));
GLUE.addObject("b", new Block(640,0,1280,50));
GLUE.addObject("b", new Block(1280,360,50,720));
GLUE.addObject("b", new Block(0,360,50,720));
GLUE.addObject("b", new Block(300,600,100,20));
