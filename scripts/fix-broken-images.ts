import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Working image URLs from reliable sources
const workingImages = {
  cars: [
    "https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1542282088-fe8426682b8f?w=500&h=500&fit=crop",
  ],
  properties: [
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1570129477492-45a003537e1f?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1512917774080-9991f1c52313?w=500&h=500&fit=crop",
  ],
  laptop: [
    "https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1588872657840-90a6d3fa3df9?w=500&h=500&fit=crop",
  ],
  phones: [
    "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1511707267537-b85faf00021e?w=500&h=500&fit=crop",
  ],
  furniture: [
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=500&h=500&fit=crop",
  ],
  electronics: [
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1498049794561-7780e6b1b914?w=500&h=500&fit=crop",
  ],
  fashion: [
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1595777707802-21b287e3fbf0?w=500&h=500&fit=crop",
  ],
  sports: [
    "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=500&fit=crop",
  ],
  default: [
    "https://images.unsplash.com/photo-1511707267537-b85faf00021e?w=500&h=500&fit=crop",
    "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop",
  ],
};

async function testImageUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function fixBrokenImages() {
  console.log("🔍 Scanning for broken images...");
  
  const ads = await prisma.ad.findMany({
    include: { images: true, category: true }
  });

  let fixed = 0;

  for (const ad of ads) {
    const categorySlug = ad.category.slug;
    const categoryImages = workingImages[categorySlug as keyof typeof workingImages] || workingImages.default;
    
    if (!ad.images || ad.images.length === 0) {
      console.log(`⚠️  Ad "${ad.title}" has no images. Adding...`);
      
      // Add images
      for (let i = 0; i < 3; i++) {
        await prisma.adImage.create({
          data: {
            adId: ad.id,
            url: categoryImages[i % categoryImages.length]
          }
        });
      }
      fixed++;
    } else {
      // Check and fix existing images
      for (let i = 0; i < ad.images.length; i++) {
        const image = ad.images[i];
        const isWorking = await testImageUrl(image.url);
        
        if (!isWorking) {
          const newUrl = categoryImages[i % categoryImages.length];
          console.log(`🔧 Fixing broken image for "${ad.title}": ${image.url}`);
          
          await prisma.adImage.update({
            where: { id: image.id },
            data: { url: newUrl }
          });
          fixed++;
        }
      }
    }
  }

  console.log(`✅ Fixed ${fixed} broken images!`);
}

fixBrokenImages()
  .catch((err) => {
    console.error("❌ Error:", err);
  })
  .finally(() => prisma.$disconnect());
