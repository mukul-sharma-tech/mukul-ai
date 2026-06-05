const { MongoClient } = require('mongodb');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']); // Force Node to use Google/Cloudflare DNS
// Replace with your local port or MongoDB Atlas connection string
const url = 'mongodb+srv://mukul:1010@nodecluster0.hurza.mongodb.net/?retryWrites=true&w=majority&appName=NodeCluster0'; 
const client = new MongoClient(url);

async function checkConnection() {
  try {
    // Attempt to establish a connection
    await client.connect();
    
    // Send a 'ping' command to the admin database to verify the connection is alive
    await client.db('admin').command({ ping: 1 });
    
    console.log("✅ Successfully connected to MongoDB!");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:");
    console.error(error.message);
  } finally {
    // Always close the connection to clean up
    await client.close();
  }
}

checkConnection();
