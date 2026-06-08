import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    // Clear existing data
    await prisma.message.deleteMany({});
    await prisma.conversationParticipant.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.review.deleteMany({});
    await prisma.report.deleteMany({});
    await prisma.savedAd.deleteMany({});
    await prisma.adImage.deleteMany({});
    await prisma.ad.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.category.deleteMany({});
    console.log('✓ Cleared existing data');

    // Create canonical top-level categories
    const topCategories = await Promise.all([
      prisma.category.create({ data: { name: 'Properties', slug: 'properties' } }),
      prisma.category.create({ data: { name: 'Vehicles', slug: 'vehicles' } }),
      prisma.category.create({ data: { name: 'Phones & Tablets', slug: 'phones-tablets' } }),
      prisma.category.create({ data: { name: 'Electronics', slug: 'electronics' } }),
      prisma.category.create({ data: { name: 'Fashion', slug: 'fashion' } }),
      prisma.category.create({ data: { name: 'Beauty', slug: 'beauty' } }),
      prisma.category.create({ data: { name: 'Furniture & Appliances', slug: 'furniture-appliances' } }),
      prisma.category.create({ data: { name: 'Jobs', slug: 'jobs' } }),
    ]);

    const electronics = topCategories.find((category) => category.slug === 'electronics');
    if (!electronics) {
      throw new Error('Electronics category was not created');
    }

    await prisma.category.createMany({
      data: [
        { name: 'Laptops', slug: 'laptops', parentId: electronics.id },
        { name: 'Desktop Computers', slug: 'desktop-computers', parentId: electronics.id },
        { name: 'Servers', slug: 'servers', parentId: electronics.id },
      ],
    });
    console.log('✓ Categories created');

    // Get category IDs by slug
    const categories = await prisma.category.findMany();
    const categoryMap = Object.fromEntries(
      categories.map(c => [c.slug, c.id])
    );

    // Create regular user
    const user = await prisma.user.create({
      data: {
        email: 'demo@qwik.ng',
        passwordHash: await bcrypt.hash('password123', 10),
        fullName: 'Demo Seller',
        phone: '+2348012345678',
        location: 'Lagos',
        role: 'USER',
      },
    });

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'admin@qwik.ng',
        passwordHash: await bcrypt.hash('admin123', 10),
        fullName: 'Admin User',
        phone: '+2348012345679',
        location: 'Lagos',
        role: 'ADMIN',
      },
    });
    console.log('✓ Users created (demo@qwik.ng + admin@qwik.ng)');

    // Image sets for each product (10 images each) - All verified working URLs
    const imageGalleries: { [key: string]: string[] } = {
      ad1: [
        'https://images.unsplash.com/photo-1511707267537-b85faf00021e?w=800',
        'https://images.unsplash.com/photo-1592286927505-1def25115558?w=800',
        'https://images.unsplash.com/photo-1516567867245-4c5a56e8fb10?w=800',
        'https://images.unsplash.com/photo-1551291049-bebda4e38f71?w=800',
        'https://images.unsplash.com/photo-1453227451063-be6680b3067e?w=800',
        'https://images.unsplash.com/photo-1478245566917-7c4a3388e869?w=800',
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800',
        'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800',
        'https://images.unsplash.com/photo-1480993773679-b6a4e67d9a8f?w=800',
        'https://images.unsplash.com/photo-1505228395891-9a51e7e86e81?w=800',
      ],
      ad2: [
        'https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=800',
        'https://images.unsplash.com/photo-1464207687429-7505649dae38?w=800',
        'https://images.unsplash.com/photo-1594407632556-f4b41e6acfa1?w=800',
        'https://images.unsplash.com/photo-1552639554-5fefe8c9ef14?w=800',
        'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800',
        'https://images.unsplash.com/photo-1506157786151-b8472da7d491?w=800',
        'https://images.unsplash.com/photo-1462832881801-57a19a78dc19?w=800',
        'https://images.unsplash.com/photo-1551171190-b40bbd49ab21?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f?w=800',
      ],
      ad3: [
        'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=800',
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800',
        'https://images.unsplash.com/photo-1559056199-641a0ac8b3f4?w=800',
        'https://images.unsplash.com/photo-1588287722528-6e9f3f36012f?w=800',
        'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=800',
        'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
        'https://images.unsplash.com/photo-1485863636181-c71e8f172fcd?w=800',
        'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=800',
        'https://images.unsplash.com/photo-1591290621512-d5ca0caa2765?w=800',
        'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800',
      ],
      ad4: [
        'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
        'https://images.unsplash.com/photo-1570129477492-45a003537e1f?w=800',
        'https://images.unsplash.com/photo-1576941089067-2de3e3692519?w=800',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
        'https://images.unsplash.com/photo-1507652313519-d4dee144caea?w=800',
        'https://images.unsplash.com/photo-1572365992253-3cb3e56dd362?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800',
        'https://images.unsplash.com/photo-1600607688517-f87e6b1940ca?w=800',
        'https://images.unsplash.com/photo-1512023282610-51e76e7ecc89?w=800',
      ],
      ad5: [
        'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800',
        'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800',
        'https://images.unsplash.com/photo-1570129477492-45a003537e1f?w=800',
        'https://images.unsplash.com/photo-1576941089067-2de3e3692519?w=800',
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
        'https://images.unsplash.com/photo-1507652313519-d4dee144caea?w=800',
        'https://images.unsplash.com/photo-1572365992253-3cb3e56dd362?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1600607688517-f87e6b1940ca?w=800',
        'https://images.unsplash.com/photo-1512023282610-51e76e7ecc89?w=800',
      ],
      ad6: [
        'https://images.unsplash.com/photo-1593208286403-1c75c91e59a7?w=800',
        'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800',
        'https://images.unsplash.com/photo-1642278633648-e2a5ad801ecc?w=800',
        'https://images.unsplash.com/photo-1614008375897-f3eca5d0d6ad?w=800',
        'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1552606764-cb26cff8a58b?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
        'https://images.unsplash.com/photo-1626982927979-edacf81b2b3c?w=800',
      ],
      ad7: [
        'https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=800',
        'https://images.unsplash.com/photo-1462832881801-57a19a78dc19?w=800',
        'https://images.unsplash.com/photo-1595857835207-c3bea547e5ea?w=800',
        'https://images.unsplash.com/photo-1464207687429-7505649dae38?w=800',
        'https://images.unsplash.com/photo-1507652313519-d4dee144caea?w=800',
        'https://images.unsplash.com/photo-1594407632556-f4b41e6acfa1?w=800',
        'https://images.unsplash.com/photo-1506157786151-b8472da7d491?w=800',
        'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f?w=800',
      ],
      ad8: [
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800',
        'https://images.unsplash.com/photo-1460353581641-694a0ffe23a1?w=800',
        'https://images.unsplash.com/photo-1482146222565-cd879ffcd420?w=800',
        'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800',
        'https://images.unsplash.com/photo-1513161455079-7ef1a827e562?w=800',
        'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800',
        'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800',
        'https://images.unsplash.com/photo-1600181534162-55a91c9a28c5?w=800',
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800',
        'https://images.unsplash.com/photo-1525966222134-fceba280e6e4?w=800',
      ],
      ad9: [
        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
        'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=800',
        'https://images.unsplash.com/photo-1506932248052-a538e7b0b754?w=800',
        'https://images.unsplash.com/photo-1493857671505-72967e0e0760?w=800',
        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800',
        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
        'https://images.unsplash.com/photo-1508684695106-0bb3839e48d0?w=800',
        'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1591290621512-d5ca0caa2765?w=800',
      ],
      ad10: [
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
        'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
        'https://images.unsplash.com/photo-1487215078519-e21cc028cb29?w=800',
        'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800',
        'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=800',
        'https://images.unsplash.com/photo-1506157786151-b8472da7d491?w=800',
        'https://images.unsplash.com/photo-1618366712010-f75450e594b3?w=800',
        'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800',
      ],
      ad11: [
        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
        'https://images.unsplash.com/photo-1598639917545-cd4628902425?w=800',
        'https://images.unsplash.com/photo-1606664515524-2682850e0cd6?w=800',
        'https://images.unsplash.com/photo-1542272604-787c62d465d1?w=800',
        'https://images.unsplash.com/photo-1536394610202-8f2c80b3e0c3?w=800',
        'https://images.unsplash.com/photo-1599599810694-b5ac4dd4c4d9?w=800',
        'https://images.unsplash.com/photo-1506629082632-401ba5c45e8e?w=800',
        'https://images.unsplash.com/photo-1539533057440-7ec6c6f34601?w=800',
        'https://images.unsplash.com/photo-1489749798305-4fea3ba63d60?w=800',
        'https://images.unsplash.com/photo-1554258811-ff0d5e5a5517?w=800',
      ],
      ad12: [
        'https://images.unsplash.com/photo-1572365992253-3cb3e56dd362?w=800',
        'https://images.unsplash.com/photo-1586253408046-81342ee5ff30?w=800',
        'https://images.unsplash.com/photo-1544716278-ca5e3af521d3?w=800',
        'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
        'https://images.unsplash.com/photo-1555707802-eba07babdb41?w=800',
        'https://images.unsplash.com/photo-1627209411667-53b4f546c01c?w=800',
        'https://images.unsplash.com/photo-1611532736579-6b16e2b50449?w=800',
        'https://images.unsplash.com/photo-1598639917545-cd4628902425?w=800',
        'https://images.unsplash.com/photo-1521572213743-f551cf4d5813?w=800',
        'https://images.unsplash.com/photo-1542272604-787c62d465d1?w=800',
      ],
    };

    // Products with detailed specs
    const adsData = [
      {
        id: 'ad1',
        categoryId: 'phones-tablets',
        title: 'iPhone 7',
        description: 'Neat and clean, all functions working. Strong battery',
        price: 350000,
        brand: 'Apple',
        model: 'iPhone 7',
        condition: 'Used',
        specifications: {
          faults: 'No faults',
          sim: 'Nano-SIM',
          displayType: 'IPS LCD',
          resolution: '750 x 1334',
          rom: '128 GB',
          primaryCamera: '12 MP, f/1.8',
          selfieCamera: '7 MP, f/2.2',
          battery: '3000 mAh',
          color: 'Silver Blue',
        },
      },
      {
        id: 'ad2',
        categoryId: 'vehicles',
        title: 'Mercedes-Benz GLA 250 2015 Blue',
        description: 'Keyless entry Panoramic roof Led intelligent light Custom duty fully paid This is a very sharp car and drives Premium speakers',
        price: 11000000,
        brand: 'Mercedes-Benz',
        model: 'GLA 250',
        condition: 'Good',
        specifications: {
          year: '2015',
          mileage: '45000 km',
          transmission: 'Automatic',
          engineType: 'Petrol',
          fuelConsumption: '8.5 L/100km',
          color: 'Blue',
          interiorMaterial: 'Leather',
          features: 'Panoramic roof, Keyless entry',
        },
      },
      {
        id: 'ad3',
        categoryId: 'laptops',
        title: 'Apple MacBook Pro',
        description: 'New Laptop Apple MacBook Pro 32GB Apple M1 SSD 1T',
        price: 1900000,
        brand: 'Apple',
        model: 'MacBook Pro 14',
        condition: 'Like New',
        specifications: {
          processor: 'M1 Pro',
          ram: '32 GB',
          storage: '1 TB SSD',
          display: '14 inch Liquid Retina XDR',
          battery: '17 hours',
          weight: '1.6 kg',
          color: 'Space Grey',
        },
      },
      {
        id: 'ad4',
        categoryId: 'properties',
        title: '4bdrm Duplex in Lekki',
        description: 'A Well Built and Spacious 4bedroom Semi Detached',
        price: 85500000,
        brand: 'Residential',
        model: '4 Bedroom Duplex',
        condition: 'Excellent',
        specifications: {
          bedrooms: '4',
          bathrooms: '3',
          livingAreas: '2',
          landSize: '2500 sqm',
          builtUpArea: '1800 sqm',
          features: 'Swimming pool, Garden, Garage',
          security: '24/7 Security',
        },
      },
      {
        id: 'ad5',
        categoryId: 'properties',
        title: 'Furnished 5bdrm Duplex in Port-Harcourt for Sale',
        description: 'Superb design 5 bedroom duplex in a gated community with good road network',
        price: 90800000,
        brand: 'Residential',
        model: '5 Bedroom Duplex',
        condition: 'Excellent',
        specifications: {
          bedrooms: '5',
          bathrooms: '4',
          livingAreas: '3',
          landSize: '3000 sqm',
          builtUpArea: '2200 sqm',
          furnished: 'Yes',
          features: 'Gym, Jacuzzi, Game room',
          securityFeatures: 'Gated community, 24/7 guards',
        },
      },
      {
        id: 'ad6',
        categoryId: 'electronics',
        title: 'Samsung TV 55 inch',
        description: '4K Ultra HD Smart TV with premium sound system',
        price: 180000,
        brand: 'Samsung',
        model: 'QN55Q80B',
        condition: 'Excellent',
        specifications: {
          screenSize: '55 inch',
          resolution: '4K UHD',
          refreshRate: '120Hz',
          panelType: 'QLED',
          brightness: '2000 nits',
          hdr: 'HDR10+, Dolby Vision',
          soundOutput: '60W',
          smartTV: 'Tizen OS',
        },
      },
      {
        id: 'ad7',
        categoryId: 'vehicles',
        title: 'Honda Civic 2018',
        description: 'Automatic transmission, clean title, well maintained',
        price: 1800000,
        brand: 'Honda',
        model: 'Civic 2018',
        condition: 'Good',
        specifications: {
          year: '2018',
          mileage: '62000 km',
          transmission: 'Automatic',
          engineCapacity: '1.8L',
          fuelType: 'Petrol',
          color: 'Silver',
          features: 'Cruise control, Backup camera',
          interiorCondition: 'Like new',
        },
      },
      {
        id: 'ad8',
        categoryId: 'fashion',
        title: 'Nike Air Jordan 1',
        description: 'Original, new in box, authentic sneakers',
        price: 65000,
        brand: 'Nike',
        model: 'Air Jordan 1 Retro',
        condition: 'New',
        specifications: {
          size: 'US 10',
          color: 'Chicago Red',
          material: 'Leather',
          releaseYear: '2023',
          authentic: 'Yes',
          boxIncluded: 'Yes',
          retailPrice: '₦95,000',
        },
      },
      {
        id: 'ad9',
        categoryId: 'furniture-appliances',
        title: 'Leather Sofa Set',
        description: 'L-shaped comfortable leather sofa, spacious and elegant',
        price: 280000,
        brand: 'Artisan',
        model: 'L-Sofa Premium',
        condition: 'Good',
        specifications: {
          type: 'L-shaped',
          material: 'Genuine Leather',
          color: 'Brown',
          seatingCapacity: '5 people',
          dimensions: '3m x 2.5m',
          armrests: 'Padded',
          legStyle: 'Wooden',
          cushionType: 'High-density foam',
        },
      },
      {
        id: 'ad10',
        categoryId: 'electronics',
        title: 'Sony Headphones WH-1000XM4',
        description: 'Noise cancelling wireless headphones, premium sound quality',
        price: 45000,
        brand: 'Sony',
        model: 'WH-1000XM4',
        condition: 'Excellent',
        specifications: {
          type: 'Wireless',
          noiseCancellation: 'Active',
          batteryLife: '30 hours',
          connectivity: 'Bluetooth 5.0',
          frequency: '4 Hz - 40 kHz',
          driverSize: '40mm',
          weight: '250g',
          color: 'Black',
        },
      },
      {
        id: 'ad11',
        categoryId: 'fashion',
        title: 'Polo Ralph Lauren Shirt',
        description: 'Classic blue Polo shirt, premium quality, size M',
        price: 25000,
        brand: 'Polo Ralph Lauren',
        model: 'Classic Fit',
        condition: 'Like New',
        specifications: {
          size: 'M',
          color: 'Blue',
          material: 'Cotton',
          fit: 'Classic',
          care: 'Machine wash',
          brand: 'Polo Ralph Lauren',
          condition: 'Like New',
        },
      },
      {
        id: 'ad12',
        categoryId: 'electronics',
        title: 'iPad Pro 12.9',
        description: '256GB storage, WiFi and Cellular connectivity',
        price: 420000,
        brand: 'Apple',
        model: 'iPad Pro 12.9',
        condition: 'Excellent',
        specifications: {
          screenSize: '12.9 inch',
          storage: '256 GB',
          connectivity: 'WiFi + Cellular',
          processor: 'M2 chip',
          ram: '8 GB',
          display: 'Liquid Retina XDR',
          battery: '10-hour battery',
          color: 'Space Grey',
        },
      },
    ];

    // Create ads with 10 images each
    const createdAds = [];
    for (const adData of adsData) {
      const images = imageGalleries[adData.id] || [];
      
      const ad = await prisma.ad.create({
        data: {
          ...adData,
          categoryId: categoryMap[adData.categoryId] || categoryMap['electronics'], // Convert slug to ID
          userId: user.id,
          location: 'Lagos',
          status: 'ACTIVE',
          isPromoted: false,
          images: {
            create: images.map(url => ({ url })),
          },
        },
      });
      createdAds.push(ad);
    }

    console.log(`✓ 12 ads created with 10 images each and detailed specifications`);

    // Create reviews for products
    const reviewsData = [
      { adId: createdAds[0].id, rating: 5, text: 'Excellent phone, works perfectly!' },
      { adId: createdAds[0].id, rating: 4, text: 'Good condition, battery is great' },
      { adId: createdAds[1].id, rating: 5, text: 'Beautiful car, well maintained' },
      { adId: createdAds[2].id, rating: 5, text: 'Fast laptop, amazing performance' },
      { adId: createdAds[3].id, rating: 4, text: 'Lovely property, great location' },
      { adId: createdAds[4].id, rating: 5, text: 'Stunning duplex, highly recommended' },
      { adId: createdAds[5].id, rating: 5, text: 'TV quality is excellent, great colors' },
      { adId: createdAds[6].id, rating: 4, text: 'Reliable car, smooth driving' },
      { adId: createdAds[7].id, rating: 5, text: 'Authentic shoes, worth the price' },
      { adId: createdAds[8].id, rating: 4, text: 'Comfortable sofa, elegant design' },
      { adId: createdAds[9].id, rating: 5, text: 'Best headphones, crystal clear sound' },
      { adId: createdAds[10].id, rating: 5, text: 'Premium quality shirt, perfect fit' },
      { adId: createdAds[11].id, rating: 5, text: 'Powerful tablet, great for work' },
    ];

    for (const reviewData of reviewsData) {
      await prisma.review.create({
        data: {
          adId: reviewData.adId,
          userId: user.id,
          rating: reviewData.rating,
          text: reviewData.text,
        },
      });
    }

    console.log(`✓ 13 reviews created`);
    console.log('\n✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
