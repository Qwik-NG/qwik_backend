const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  try {
    // Clear existing data
    await prisma.savedAd.deleteMany({});
    await prisma.adImage.deleteMany({});
    await prisma.ad.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.category.deleteMany({});
    console.log('✓ Cleared existing data');

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

    // Create ads with images
    const adsData = [
      { id: 'ad1', categoryId: 'cat1', title: 'iPhone 13 Pro', description: 'Excellent condition, 256GB storage', price: 350000, brand: 'Apple', model: 'iPhone 13 Pro', condition: 'Like New' },
      { id: 'ad2', categoryId: 'cat2', title: 'Toyota Camry 2019', description: 'Clean title, well maintained', price: 2500000, brand: 'Toyota', model: 'Camry', condition: 'Good' },
      { id: 'ad3', categoryId: 'cat3', title: 'Designer Handbag', description: 'Authentic, mint condition', price: 85000, brand: 'Gucci', model: 'Marmont', condition: 'Like New' },
      { id: 'ad4', categoryId: 'cat4', title: 'Office Desk', description: 'Wooden desk, spacious', price: 45000, brand: 'Artisan', model: 'Classic', condition: 'Good' },
      { id: 'ad5', categoryId: 'cat1', title: 'Samsung TV 55', description: '4K Ultra HD Smart TV', price: 180000, brand: 'Samsung', model: 'QN55Q80B', condition: 'Excellent' },
      { id: 'ad6', categoryId: 'cat1', title: 'MacBook Pro 14', description: 'M1 Pro, 512GB SSD', price: 650000, brand: 'Apple', model: 'MacBook Pro 14', condition: 'Like New' },
      { id: 'ad7', categoryId: 'cat2', title: 'Honda Civic 2018', description: 'Automatic, clean', price: 1800000, brand: 'Honda', model: 'Civic', condition: 'Good' },
      { id: 'ad8', categoryId: 'cat3', title: 'Nike Air Jordan 1', description: 'Original, new in box', price: 65000, brand: 'Nike', model: 'AJ1 Retro', condition: 'New' },
      { id: 'ad9', categoryId: 'cat4', title: 'Leather Sofa Set', description: 'L-shaped, comfortable', price: 280000, brand: 'Artisan', model: 'L-Sofa', condition: 'Good' },
      { id: 'ad10', categoryId: 'cat1', title: 'Sony Headphones', description: 'Noise cancelling, wireless', price: 45000, brand: 'Sony', model: 'WH-1000XM4', condition: 'Excellent' },
      { id: 'ad11', categoryId: 'cat3', title: 'Polo Ralph Lauren', description: 'Classic blue, size M', price: 25000, brand: 'Polo Ralph Lauren', model: 'Classic Fit', condition: 'Like New' },
      { id: 'ad12', categoryId: 'cat1', title: 'iPad Pro 12.9', description: '256GB, WiFi+Cellular', price: 420000, brand: 'Apple', model: 'iPad Pro 12.9', condition: 'Excellent' },
    ];

    const images = [
      'https://images.unsplash.com/photo-1592286927505-1def25115558?w=500',
      'https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=500',
      'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500',
      'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500',
      'https://images.unsplash.com/photo-1567049677904-da330dbf6380?w=500',
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500',
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500',
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500',
      'https://images.unsplash.com/photo-1533139502658-0eec59e8b86b?w=500',
      'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=500',
      'https://images.unsplash.com/photo-1572365992253-3cb3e56dd362?w=500',
    ];

    for (let i = 0; i < adsData.length; i++) {
      const adData = adsData[i];
      await prisma.ad.create({
        data: {
          id: adData.id,
          userId: 'user1',
          categoryId: adData.categoryId,
          title: adData.title,
          description: adData.description,
          price: adData.price,
          location: 'Lagos',
          brand: adData.brand,
          model: adData.model,
          condition: adData.condition,
          specifications: {},
          status: 'ACTIVE',
          isPromoted: false,
          images: {
            create: {
              url: images[i],
            },
          },
        },
      });
    }
    console.log(`✓ 12 ads created with images`);
    console.log('\n✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
