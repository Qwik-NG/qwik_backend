const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    // Create categories
    await prisma.category.createMany({
      data: [
        { id: 'cat1', name: 'Electronics', slug: 'electronics' },
        { id: 'cat2', name: 'Cars', slug: 'cars' },
        { id: 'cat3', name: 'Fashion', slug: 'fashion' },
        { id: 'cat4', name: 'Furniture', slug: 'furniture' },
      ],
    });
    console.log('✓ Categories created');

    // Create user
    await prisma.user.create({
      data: {
        id: 'user1',
        email: 'seller@test.com',
        passwordHash: 'hash123',
        fullName: 'Test Seller',
        phone: '+2348012345678',
        location: 'Lagos',
      },
    });
    console.log('✓ User created');

    // Create ads
    const ads = [
      {
        id: 'ad1',
        userId: 'user1',
        categoryId: 'cat1',
        title: 'iPhone 13 Pro',
        description: 'Excellent condition, 256GB storage',
        price: 350000,
        location: 'Lagos',
        brand: 'Apple',
        model: 'iPhone 13 Pro',
        condition: 'Like New',
        specifications: { color: 'Space Grey', storage: '256GB' },
      },
      {
        id: 'ad2',
        userId: 'user1',
        categoryId: 'cat2',
        title: 'Toyota Camry 2019',
        description: 'Clean title, well maintained',
        price: 2500000,
        location: 'Lagos',
        brand: 'Toyota',
        model: 'Camry',
        condition: 'Good',
        specifications: { year: 2019, mileage: 45000 },
      },
      {
        id: 'ad3',
        userId: 'user1',
        categoryId: 'cat3',
        title: 'Designer Handbag',
        description: 'Authentic, mint condition',
        price: 85000,
        location: 'Lagos',
        brand: 'Gucci',
        model: 'Marmont',
        condition: 'Like New',
        specifications: { material: 'Leather', color: 'Black' },
      },
      {
        id: 'ad4',
        userId: 'user1',
        categoryId: 'cat4',
        title: 'Office Desk',
        description: 'Wooden desk, spacious',
        price: 45000,
        location: 'Lagos',
        brand: 'Artisan',
        model: 'Classic',
        condition: 'Good',
        specifications: { material: 'Wood', color: 'Brown' },
      },
      {
        id: 'ad5',
        userId: 'user1',
        categoryId: 'cat1',
        title: 'Samsung TV 55 inch',
        description: '4K Ultra HD Smart TV',
        price: 180000,
        location: 'Lagos',
        brand: 'Samsung',
        model: 'QN55Q80B',
        condition: 'Excellent',
        specifications: { size: '55 inch', resolution: '4K' },
      },
      {
        id: 'ad6',
        userId: 'user1',
        categoryId: 'cat1',
        title: 'MacBook Pro 14',
        description: 'M1 Pro, 512GB SSD, pristine',
        price: 650000,
        location: 'Lagos',
        brand: 'Apple',
        model: 'MacBook Pro 14',
        condition: 'Like New',
        specifications: { processor: 'M1 Pro', storage: '512GB' },
      },
      {
        id: 'ad7',
        userId: 'user1',
        categoryId: 'cat2',
        title: 'Honda Civic 2018',
        description: 'Automatic transmission, clean',
        price: 1800000,
        location: 'Lagos',
        brand: 'Honda',
        model: 'Civic',
        condition: 'Good',
        specifications: { year: 2018, transmission: 'Automatic' },
      },
      {
        id: 'ad8',
        userId: 'user1',
        categoryId: 'cat3',
        title: 'Nike Air Jordan 1',
        description: 'Original, new in box',
        price: 65000,
        location: 'Lagos',
        brand: 'Nike',
        model: 'Air Jordan 1 Retro',
        condition: 'New',
        specifications: { size: 'US 10', color: 'Chicago' },
      },
      {
        id: 'ad9',
        userId: 'user1',
        categoryId: 'cat4',
        title: 'Leather Sofa Set',
        description: 'L-shaped, comfortable',
        price: 280000,
        location: 'Lagos',
        brand: 'Artisan',
        model: 'L-Sofa',
        condition: 'Good',
        specifications: { type: 'L-shaped', color: 'Brown' },
      },
      {
        id: 'ad10',
        userId: 'user1',
        categoryId: 'cat1',
        title: 'Sony Headphones',
        description: 'Noise cancelling, wireless',
        price: 45000,
        location: 'Lagos',
        brand: 'Sony',
        model: 'WH-1000XM4',
        condition: 'Excellent',
        specifications: { type: 'Wireless', feature: 'Noise Cancelling' },
      },
      {
        id: 'ad11',
        userId: 'user1',
        categoryId: 'cat3',
        title: 'Polo Ralph Lauren Shirt',
        description: 'Classic blue, size M',
        price: 25000,
        location: 'Lagos',
        brand: 'Polo Ralph Lauren',
        model: 'Classic Fit',
        condition: 'Like New',
        specifications: { size: 'M', color: 'Blue' },
      },
      {
        id: 'ad12',
        userId: 'user1',
        categoryId: 'cat1',
        title: 'iPad Pro 12.9',
        description: '256GB, WiFi+Cellular',
        price: 420000,
        location: 'Lagos',
        brand: 'Apple',
        model: 'iPad Pro 12.9',
        condition: 'Excellent',
        specifications: { storage: '256GB', connectivity: 'WiFi+Cellular' },
      },
    ];

    for (const ad of ads) {
      await prisma.ad.create({
        data: {
          ...ad,
          images: {
            create: {
              url: `https://images.unsplash.com/photo-${Math.random().toString(36).substring(7)}?w=500`,
            },
          },
        },
      });
    }
    console.log('✓ 12 ads created');

    console.log('\n✅ Seed data inserted successfully!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
