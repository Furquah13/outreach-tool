const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const { PrismaClient } = require('@prisma/client');

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize Redis connection
const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
});

// Get rate limit from environment variable (default 80)
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '80', 10);

console.log(`Worker starting with rate limit: ${RATE_LIMIT_PER_MINUTE} emails per minute`);

// Initialize queues
const sendQueue = new Queue('send-emails', { connection });
const webhookQueue = new Queue('webhooks', { connection });

// Rate limiting class
class RateLimiter {
  constructor(limit) {
    this.limit = limit;
    this.sent = 0;
    this.resetTime = Date.now() + 60000; // Reset every minute
  }

  async canSend() {
    const now = Date.now();
    
    // Reset counter every minute
    if (now >= this.resetTime) {
      this.sent = 0;
      this.resetTime = now + 60000;
    }

    if (this.sent >= this.limit) {
      const waitTime = this.resetTime - now;
      console.log(`Rate limit reached. Waiting ${waitTime}ms before next send.`);
      return false;
    }

    return true;
  }

  incrementSent() {
    this.sent++;
  }
}

// Create rate limiter instance
const rateLimiter = new RateLimiter(RATE_LIMIT_PER_MINUTE);

// Email sending function (placeholder)
async function sendEmail(emailData) {
  console.log(`[PLACEHOLDER] Sending email to ${emailData.to}:`);
  console.log(`Subject: ${emailData.subject}`);
  console.log(`Content: ${emailData.content.substring(0, 100)}...`);
  
  // Simulate email sending delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Return success (in real implementation, this would be actual email sending result)
  return {
    success: true,
    messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date()
  };
}

// Email job processor
async function processEmailJob(job) {
  const { leadId, campaignLeadId, campaignStepId, emailData } = job.data;
  
  try {
    console.log(`Processing email job for lead ${leadId}, campaignLead ${campaignLeadId}, step ${campaignStepId}`);
    
    // Check rate limit
    while (!(await rateLimiter.canSend())) {
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Send email (placeholder implementation)
    const result = await sendEmail(emailData);
    
    // Increment rate limiter counter
    rateLimiter.incrementSent();
    
    // Record send event in database
    const sendEvent = await prisma.sendEvent.create({
      data: {
        eventType: result.success ? 'SENT' : 'FAILED',
        leadId: leadId,
        campaignLeadId: campaignLeadId,
        campaignStepId: campaignStepId,
        sentAt: result.timestamp || new Date(),
        errorMessage: result.success ? null : (result.error || 'Unknown error'),
        metadata: {
          messageId: result.messageId,
          rateLimitCount: rateLimiter.sent,
          processingTime: Date.now() - job.timestamp
        }
      }
    });
    
    console.log(`Email sent successfully. SendEvent ID: ${sendEvent.id}`);
    
    // Update campaign lead status if needed
    if (result.success) {
      await prisma.campaignLead.update({
        where: { id: campaignLeadId },
        data: { 
          updatedAt: new Date()
        }
      });
      
      // Update lead status
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'CONTACTED',
          updatedAt: new Date()
        }
      });
    }
    
    return { success: true, sendEventId: sendEvent.id };
    
  } catch (error) {
    console.error(`Failed to process email job for lead ${leadId}:`, error);
    
    // Record failed send event
    try {
      await prisma.sendEvent.create({
        data: {
          eventType: 'FAILED',
          leadId: leadId,
          campaignLeadId: campaignLeadId,
          campaignStepId: campaignStepId,
          sentAt: new Date(),
          errorMessage: error.message,
          metadata: {
            error: error.stack,
            processingTime: Date.now() - job.timestamp
          }
        }
      });
    } catch (dbError) {
      console.error('Failed to record error in database:', dbError);
    }
    
    throw error;
  }
}

// Webhook job processor
async function processWebhookJob(job) {
  const { type, data } = job.data;
  
  try {
    console.log(`Processing webhook job of type: ${type}`);
    
    // Handle different webhook types
    switch (type) {
      case 'email_delivered':
        await prisma.sendEvent.updateMany({
          where: { 
            metadata: {
              path: ['messageId'],
              equals: data.messageId
            }
          },
          data: {
            eventType: 'DELIVERED',
            deliveredAt: new Date(data.timestamp)
          }
        });
        break;
        
      case 'email_opened':
        await prisma.sendEvent.updateMany({
          where: { 
            metadata: {
              path: ['messageId'],
              equals: data.messageId
            }
          },
          data: {
            openedAt: new Date(data.timestamp)
          }
        });
        break;
        
      case 'email_clicked':
        await prisma.sendEvent.updateMany({
          where: { 
            metadata: {
              path: ['messageId'],
              equals: data.messageId
            }
          },
          data: {
            clickedAt: new Date(data.timestamp)
          }
        });
        break;
        
      case 'email_bounced':
        await prisma.sendEvent.updateMany({
          where: { 
            metadata: {
              path: ['messageId'],
              equals: data.messageId
            }
          },
          data: {
            eventType: 'BOUNCED',
            bouncedAt: new Date(data.timestamp),
            errorMessage: data.reason
          }
        });
        break;
        
      default:
        console.log(`Unknown webhook type: ${type}`);
    }
    
    console.log(`Webhook ${type} processed successfully`);
    return { success: true };
    
  } catch (error) {
    console.error(`Failed to process webhook ${type}:`, error);
    throw error;
  }
}

// Create workers
const emailWorker = new Worker('send-emails', processEmailJob, {
  connection,
  concurrency: 1, // Process one email at a time to respect rate limits
  limiter: {
    max: RATE_LIMIT_PER_MINUTE,
    duration: 60000, // 1 minute
  },
});

const webhookWorker = new Worker('webhooks', processWebhookJob, {
  connection,
  concurrency: 5, // Can process multiple webhooks concurrently
});

// Event handlers
emailWorker.on('completed', (job) => {
  console.log(`Email job ${job.id} completed successfully`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`Email job ${job.id} failed:`, err.message);
});

webhookWorker.on('completed', (job) => {
  console.log(`Webhook job ${job.id} completed successfully`);
});

webhookWorker.on('failed', (job, err) => {
  console.error(`Webhook job ${job.id} failed:`, err.message);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down workers...');
  await emailWorker.close();
  await webhookWorker.close();
  await prisma.$disconnect();
  await connection.quit();
  console.log('Workers shut down gracefully');
  process.exit(0);
});

console.log('BullMQ workers started successfully!');
console.log('- Email worker (send-emails queue) - concurrency: 1');
console.log('- Webhook worker (webhooks queue) - concurrency: 5');
console.log(`- Rate limit: ${RATE_LIMIT_PER_MINUTE} emails per minute`);
console.log('Worker is ready to process jobs...');
