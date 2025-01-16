const WebSocket = require('ws');

const PORT = 8081;

try {
  const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`WebSocket server is running on port ${PORT}`);
  });

  const players = new Map();

  // Broadcast player positions every 16ms (roughly 60fps)
  setInterval(() => {
    const playerData = Array.from(players.entries());
    const updateMessage = JSON.stringify({
      type: 'players',
      players: playerData
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(updateMessage);
      }
    });
  }, 16);

  // At the top level, add a function to broadcast to all clients
  function broadcast(message) {
    if (message.type !== 'players') {  // Don't log position broadcasts
      console.log('Broadcasting message:', message);
    }
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  wss.on('connection', (ws) => {
    console.log('New client connected. Current connections:', wss.clients.size);
    let playerId = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Only log non-update messages
        if (data.type !== 'update') {
          console.log('Received message:', data.type, data);
        }
        
        switch(data.type) {
          case 'join':
            console.log('Join request from:', data.name);
            if (!data.name || data.name.trim() === '') {
              console.log('Invalid name, rejecting connection');
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid name'
              }));
              ws.close();
              return;
            }
            
            playerId = data.name;
            players.set(playerId, {
              name: data.name,
              position: data.position,
              rotation: data.rotation,
              health: 100
            });
            console.log('Player joined. Current players:', Array.from(players.keys()));
            break;
            
          case 'update':
            // Silent update - no logging
            if (playerId && players.has(playerId)) {
              const oldHealth = players.get(playerId).health;
              players.set(playerId, {
                name: playerId,
                position: data.position,
                rotation: data.rotation,
                health: oldHealth
              });
            }
            break;

          case 'cannonFire':
            console.log('Cannon fire from:', playerId, 'side:', data.side);
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'cannonFire',
                  playerId: playerId,
                  side: data.side,
                  position: data.position,
                  rotation: data.rotation
                }));
              }
            });
            break;

          case 'hit':
            const target = players.get(data.target);
            console.log('Hit detected:', {
              shooter: data.shooterName,
              target: data.target,
              damage: data.damage,
              targetCurrentHealth: target?.health
            });
            
            if (target) {
              const oldHealth = target.health || 100;
              const newHealth = Math.max(0, oldHealth - data.damage);
              target.health = newHealth;
              
              console.log(`Player ${data.target} health reduced from ${oldHealth} to ${newHealth}`);
              
              broadcast({
                type: 'hit',
                target: data.target,
                damage: data.damage,
                shooterName: data.shooterName,
                remainingHealth: newHealth
              });

              if (newHealth <= 0) {
                console.log(`Player ${data.target} has been sunk by ${data.shooterName}!`);
                broadcast({
                  type: 'kill',
                  killer: data.shooterName,
                  victim: data.target
                });
                
                // Reset player's health
                target.health = 100;
                console.log(`Reset ${data.target}'s health to 100`);
              }
            } else {
              console.log('Target player not found:', data.target);
            }
            break;
        }
      } catch (err) {
        console.error('Error processing message:', err);
        console.error('Message content:', message.toString());
      }
    });

    ws.on('close', () => {
      if (playerId) {
        console.log(`Player ${playerId} disconnected. Remaining players:`, Array.from(players.keys()));
        players.delete(playerId);
        broadcast({
          type: 'playerLeft',
          playerId: playerId
        });
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  wss.on('error', (error) => {
    console.error('Server error:', error);
  });

} catch (err) {
  console.error('Failed to start server:', err);
} 