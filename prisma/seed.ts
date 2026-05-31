import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categoryNames = [
  "Cars",
  "Phones",
  "Jobs",
  "Agriculture",
  "Sports",
  "Fashion",
  "Electronics",
  "Properties",
  "Furniture",
  "Laptop",
  "Beauty"
];

async function main() {
  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { slug: name.toLowerCase().replace(/\s+/g, "-") },
      update: {},
      create: { name, slug: name.toLowerCase().replace(/\s+/g, "-") }
    });
  }

  const email = "demo@qwik.ng";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        fullName: "Demo Seller",
        passwordHash: await bcrypt.hash("password123", 10),
        location: "Lagos, Ikeja",
        profile: { create: { bio: "Trusted seller" } }
      }
    });
  }

  const categories = await prisma.category.findMany();
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  const demoAds = [
    {
      slug: "cars",
      title: "Mercedes-Benz GLA 250 2015 Blue",
      description: "Keyless entry, panoramic roof, LED light, custom duty paid.",
      price: 16000000,
      location: "Abuja, Apo",
      images: [
        "https://images.unsplash.com/photo-1542282088-fe8426682b8f?w=1200",
        "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1200"
      ]
    },
    {
      slug: "properties",
      title: "Furnished 5 Bedroom Duplex",
      description: "Modern duplex in a serene estate with security and steady power.",
      price: 90800000,
      location: "Rivers, Port-Harcourt",
      images: [
        "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200"
      ]
    },
    {
      slug: "laptop",
      title: "Apple MacBook Pro M1 32GB",
      description: "Clean MacBook Pro, 1TB SSD, very fast and excellent battery life.",
      price: 1900000,
      location: "Lagos, Ikeja",
      images: [
        "https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=1200"
      ]
    },
    {
      slug: "phones",
      title: "iPhone 13 Pro 256GB",
      description: "Neat condition, factory unlocked, Face ID working perfectly.",
      price: 950000,
      location: "Abuja, Wuse",
      images: [
        "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=1200"
      ]
    }
  ];

  for (const demoAd of demoAds) {
    const category = bySlug[demoAd.slug];
    if (!category) continue;

    const exists = await prisma.ad.findFirst({
      where: { title: demoAd.title, userId: user.id }
    });
    if (exists) continue;

    await prisma.ad.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        title: demoAd.title,
        description: demoAd.description,
        price: demoAd.price,
        location: demoAd.location,
        images: {
          create: demoAd.images.map((url) => ({ url }))
        }
      }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
