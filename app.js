    const express = require('express');
    const WebSocket = require('ws');
    const mysql = require('mysql2/promise');
    const http = require('http');
    require('dotenv').config();
    const app = express();

    // Create HTTP server using Express
    const server = http.createServer(app);

    // Create WebSocket server attached to HTTP server
    const wss = new WebSocket.Server({ server });

    // Keep track of all connected clients
    let clients = []

    // Create MySQL connection pool
    const db = mysql.createPool({
        host: '94.23.162.175',
        user: 'xian',
        password: 'v9Bw$1bc£31u',
        database: 'bidcar',
    });

    // WebSocket server listens for connections
    wss.on('connection', function connection(ws, req) {
        try {
            const params = new URLSearchParams(req.url.replace('/?', ''));
            const auctionId = params.get('auction_id');
            const appKey = params.get('appKey');

            if (!auctionId || !appKey) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid auction_id or appKey' }));
                ws.close();
                return;
            }

            console.log(`New connection for auction ${auctionId} with appKey ${appKey}`);

            // Add the new client to the client list
            const client = { ws, auctionId, appKey };
            clients.push(client);

            // Notify the client they've connected
            ws.send(JSON.stringify({ type: 'set-user', message: 'You are connected!' }));

            // Handle messages received from this client
            ws.on('message', async function incoming(message) {
                try {
                    const parsedMessage = JSON.parse(message);

                    if (parsedMessage.type === 'place-bid') {
                        // Broadcast bid to all clients connected to the same auction
                        const payload = {
                            type: 'new-bid',
                            user_name: parsedMessage.user_name,
                            bid: parsedMessage.bid,
                        };
                        broadcastToAuction(auctionId, payload);

                    } else if (parsedMessage.type === 'add-stock-hash') {
                        // Handle adding stock hash to MySQL database
                        await db.query('INSERT INTO auction_statuses (auction_id, stock_hash) VALUES (?, ?)', [auctionId, parsedMessage.stock_hash]);
                        console.log('Stock hash added to auction:', parsedMessage.stock_hash);

                    } else if (parsedMessage.type === 'get-history') {
                        // Retrieve the last 3 bids for this auction
                        const [rows] = await db.query(`
                            SELECT bu.*, u.name as user_name    
                            FROM bidding_users bu 
                            LEFT JOIN users u ON u.id = bu.user_id 
                            WHERE bu.biddings_id = ? 
                            ORDER BY bu.id DESC 
                            LIMIT 3`, [parsedMessage.bid_id]);

                        // Count total history
                        const [historyCountRows] = await db.query(`
                            SELECT COUNT(*) as count 
                            FROM bidding_users 
                            WHERE biddings_id = ?`, [parsedMessage.bid_id]);

                        const historyCount = historyCountRows[0].count;

                        const payload = {
                            type: 'history',
                            count: historyCount,
                            history: rows,
                            key: parsedMessage.key,
                        };
                        broadcastToAuction(auctionId, payload);

                        // Optionally, store the auction status with the key
                        await db.query('INSERT INTO auction_statuses (auction_id, stock_hash) VALUES (?, ?)', [auctionId, parsedMessage.key]);
                    }
                } catch (err) {
                    console.error('Error handling message:', err.message);
                    ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
                }
            });

            // Handle WebSocket errors
            ws.on('error', (err) => {
                console.error('WebSocket error:', err.message);
            });

            // Handle client disconnection
            ws.on('close', function close() {
                clients = clients.filter(c => c.ws !== ws);
                console.log(`Client for auction ${auctionId} disconnected`);
            });

        } catch (err) {
            console.error('Error during connection setup:', err.message);
            ws.send(JSON.stringify({ type: 'error', message: 'Connection error' }));
            ws.close();
        }
    });

    // Broadcast message to all clients in the same auction
    function broadcastToAuction(auctionId, message) {
        clients.forEach(client => {
            if (client.auctionId === auctionId) {
                try {
                    client.ws.send(JSON.stringify(message));
                } catch (err) {
                    console.error('Error broadcasting message:', err.message);
                }
            }
        });
    };

    // Start the Express HTTP server and WebSocket server 
    const port = process.env.PORT || 7080;

    server.listen(port, () => {
        console.log(`Server is running on ${port}`);
        console.log(`WebSocket server is listening on ws://localhost:${port}`);
    });
