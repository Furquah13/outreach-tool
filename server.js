const express = require('express');
const app = express();

// Get port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON
app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.send('Outreach Tool API v0');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Outreach Tool API v0 listening on port ${PORT}`);
});
