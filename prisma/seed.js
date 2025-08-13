const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a sample user
  const user = await prisma.user.upsert({
    where: { email: 'demo@outreach-tool.com' },
    update: {},
    create: {
      email: 'demo@outreach-tool.com',
      name: 'Demo User',
    },
  });

  console.log('✅ User created:', user.email);

  // Create sample leads
  const leads = await Promise.all([
    prisma.lead.upsert({
      where: { email: 'john.doe@example.com' },
      update: {},
      create: {
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
        company: 'Tech Corp',
        position: 'CEO',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
        notes: 'Potential high-value prospect',
        status: 'NEW',
      },
    }),
    prisma.lead.upsert({
      where: { email: 'jane.smith@example.com' },
      update: {},
      create: {
        email: 'jane.smith@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        company: 'Marketing Solutions Inc',
        position: 'CMO',
        linkedinUrl: 'https://linkedin.com/in/janesmith',
        notes: 'Interested in marketing automation',
        status: 'NEW',
      },
    }),
    prisma.lead.upsert({
      where: { email: 'mike.johnson@example.com' },
      update: {},
      create: {
        email: 'mike.johnson@example.com',
        firstName: 'Mike',
        lastName: 'Johnson',
        company: 'Startup Ventures',
        position: 'Founder',
        linkedinUrl: 'https://linkedin.com/in/mikejohnson',
        notes: 'Early-stage startup, budget conscious',
        status: 'NEW',
      },
    }),
  ]);

  console.log(`✅ ${leads.length} leads created`);

  // Create a sample campaign
  const campaign = await prisma.campaign.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Q1 Outreach Campaign',
      description: 'Initial outreach campaign for Q1 prospects',
      status: 'DRAFT',
      userId: user.id,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-03-31'),
    },
  });

  console.log('✅ Campaign created:', campaign.name);

  // Create campaign steps
  const campaignSteps = await Promise.all([
    prisma.campaignStep.upsert({
      where: { campaignId_stepNumber: { campaignId: campaign.id, stepNumber: 1 } },
      update: {},
      create: {
        campaignId: campaign.id,
        stepNumber: 1,
        name: 'Initial Outreach',
        subject: 'Quick question about {{company}}',
        content: `Hi {{firstName}},\n\nI came across {{company}} and was impressed by your work in the {{position}} role.\n\nI'd love to share how companies like yours are streamlining their outreach processes. Would you be open to a brief 15-minute call this week?\n\nBest regards,\nDemo User`,
        delayDays: 0,
        stepType: 'EMAIL',
        isActive: true,
      },
    }),
    prisma.campaignStep.upsert({
      where: { campaignId_stepNumber: { campaignId: campaign.id, stepNumber: 2 } },
      update: {},
      create: {
        campaignId: campaign.id,
        stepNumber: 2,
        name: 'Follow-up',
        subject: 'Re: Quick question about {{company}}',
        content: `Hi {{firstName}},\n\nI wanted to follow up on my previous email about streamlining outreach processes.\n\nMany companies in your industry have seen 3x improvement in response rates. I think {{company}} could benefit from a similar approach.\n\nWould you be interested in a quick demo?\n\nBest,\nDemo User`,
        delayDays: 3,
        stepType: 'EMAIL',
        isActive: true,
      },
    }),
    prisma.campaignStep.upsert({
      where: { campaignId_stepNumber: { campaignId: campaign.id, stepNumber: 3 } },
      update: {},
      create: {
        campaignId: campaign.id,
        stepNumber: 3,
        name: 'Final Follow-up',
        subject: 'Last check-in - {{company}}',
        content: `Hi {{firstName}},\n\nThis will be my final follow-up regarding our outreach optimization solution.\n\nIf you're not interested, no worries at all. If timing isn't right now, feel free to reach out when it makes sense for {{company}}.\n\nThanks for your time!\n\nBest regards,\nDemo User`,
        delayDays: 7,
        stepType: 'EMAIL',
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ ${campaignSteps.length} campaign steps created`);

  // Add leads to campaign
  const campaignLeads = await Promise.all(
    leads.map((lead) =>
      prisma.campaignLead.upsert({
        where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
        update: {},
        create: {
          campaignId: campaign.id,
          leadId: lead.id,
          status: 'PENDING',
          currentStep: 1,
        },
      })
    )
  );

  console.log(`✅ ${campaignLeads.length} leads added to campaign`);

  console.log('🎉 Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
