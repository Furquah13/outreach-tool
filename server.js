const express = require('express');
const { PrismaClient } = require('@prisma/client');
const app = express();
const prisma = new PrismaClient();

// Get port and tracking domain from environment variables
const PORT = process.env.PORT || 3000;
const TRACKING_DOMAIN = process.env.TRACKING_DOMAIN || 'localhost:3000';

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

// Redirect endpoint for tracking link clicks
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;
  const { url } = req.query;
  
  try {
    // Validate that the redirect ID exists and get the associated data
    const redirectData = JSON.parse(Buffer.from(id, 'base64').toString('utf-8'));
    const { leadId, campaignLeadId, campaignStepId, originalUrl } = redirectData;
    
    // Record click event in database
    await prisma.sendEvent.updateMany({
      where: {
        leadId: leadId,
        campaignLeadId: campaignLeadId,
        campaignStepId: campaignStepId,
        eventType: 'SENT'
      },
      data: {
        clickedAt: new Date()
      }
    });
    
    // Redirect to the original URL
    const targetUrl = url || originalUrl;
    if (targetUrl) {
      res.redirect(targetUrl);
    } else {
      res.status(400).send('Invalid redirect URL');
    }
  } catch (error) {
    console.error('Redirect tracking error:', error);
    // Even if tracking fails, redirect to the URL if provided
    if (req.query.url) {
      res.redirect(req.query.url);
    } else {
      res.status(400).send('Invalid redirect');
    }
  }
});

// Tracking pixel endpoint
app.get('/o.png', async (req, res) => {
  const { id } = req.query;
  
  try {
    if (id) {
      // Decode the tracking data
      const trackingData = JSON.parse(Buffer.from(id, 'base64').toString('utf-8'));
      const { leadId, campaignLeadId, campaignStepId } = trackingData;
      
      // Record open event in database
      await prisma.sendEvent.updateMany({
        where: {
          leadId: leadId,
          campaignLeadId: campaignLeadId,
          campaignStepId: campaignStepId,
          eventType: 'SENT'
        },
        data: {
          openedAt: new Date()
        }
      });
    }
  } catch (error) {
    console.error('Open tracking error:', error);
  }
  
  // Return 1x1 transparent pixel
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  
  res.send(pixel);
});

// Unsubscribe endpoint
app.get('/unsubscribe/:leadId', async (req, res) => {
  const { leadId } = req.params;
  
  try {
    // Parse leadId (it might be encoded)
    let actualLeadId;
    try {
      // Try to decode if it's base64 encoded
      const decoded = JSON.parse(Buffer.from(leadId, 'base64').toString('utf-8'));
      actualLeadId = decoded.leadId;
    } catch {
      // If decoding fails, use as is
      actualLeadId = parseInt(leadId);
    }
    
    // Update all active campaign leads for this lead to unsubscribed status
    await prisma.campaignLead.updateMany({
      where: {
        leadId: actualLeadId,
        status: {
          in: ['PENDING', 'ACTIVE']
        }
      },
      data: {
        status: 'UNSUBSCRIBED',
        updatedAt: new Date()
      }
    });
    
    // Update lead status
    await prisma.lead.update({
      where: { id: actualLeadId },
      data: {
        status: 'UNQUALIFIED',
        updatedAt: new Date()
      }
    });
    
    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unsubscribed</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #28a745; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ You have been unsubscribed</h1>
          <p>You have successfully unsubscribed from our outreach emails.</p>
          <p>You will no longer receive emails from our campaigns.</p>
          <p>If you have any questions, please contact our support team.</p>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).send('Error processing unsubscribe request.');
  }
});

// Helper function to generate tracking URLs (for use in email templates)
app.get('/api/generate-tracking-urls', (req, res) => {
  const { leadId, campaignLeadId, campaignStepId, originalUrl } = req.query;
  
  if (!leadId || !campaignLeadId || !campaignStepId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  const trackingData = {
    leadId: parseInt(leadId),
    campaignLeadId: parseInt(campaignLeadId),
    campaignStepId: parseInt(campaignStepId)
  };
  
  if (originalUrl) {
    trackingData.originalUrl = originalUrl;
  }
  
  const encodedData = Buffer.from(JSON.stringify(trackingData)).toString('base64');
  const protocol = req.get('x-forwarded-proto') || (req.connection.encrypted ? 'https' : 'http');
  const trackingDomain = TRACKING_DOMAIN.startsWith('http') ? TRACKING_DOMAIN : `${protocol}://${TRACKING_DOMAIN}`;
  
  const trackingUrls = {
    pixelUrl: `${trackingDomain}/o.png?id=${encodedData}`,
    unsubscribeUrl: `${trackingDomain}/unsubscribe/${Buffer.from(JSON.stringify({ leadId: parseInt(leadId) })).toString('base64')}`,
    generateRedirectUrl: (url) => {
      const redirectData = { ...trackingData, originalUrl: url };
      const encodedRedirectData = Buffer.from(JSON.stringify(redirectData)).toString('base64');
      return `${trackingDomain}/r/${encodedRedirectData}?url=${encodeURIComponent(url)}`;
    }
  };
  
  res.json(trackingUrls);
});

// Start server
app.listen(PORT, () => {
  console.log(`Outreach Tool API v0 listening on port ${PORT}`);
  console.log(`Tracking domain: ${TRACKING_DOMAIN}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await prisma.$disconnect();
  console.log('Server shut down gracefully');
  process.exit(0);
});
