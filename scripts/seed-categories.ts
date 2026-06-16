/* eslint-disable no-console */
/**
 * Idempotent category seed.
 * - Upserts parent and child categories by slug
 * - Never deletes existing data
 * - Safe to run multiple times
 *
 * Run: npx ts-node-dev --transpile-only scripts/seed-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ChildSpec = { name: string; slug: string };
type ParentSpec = { name: string; slug: string; children: ChildSpec[] };

const TREE: ParentSpec[] = [
  {
    name: "Vehicles",
    slug: "vehicles",
    children: [
      { name: "Cars", slug: "cars" },
      { name: "Motorcycles", slug: "motorcycles" },
      { name: "Trucks & Trailers", slug: "trucks-trailers" },
      { name: "Buses", slug: "buses" },
      { name: "Vehicle Parts", slug: "vehicle-parts" },
    ],
  },
  {
    name: "Phones & Tablets",
    slug: "phones-tablets",
    children: [
      { name: "Mobile Phones", slug: "mobile-phones" },
      { name: "Tablets", slug: "tablets" },
      { name: "Phone & Tablet Accessories", slug: "phone-tablet-accessories" },
    ],
  },
  {
    name: "Electronics",
    slug: "electronics",
    children: [
      { name: "Laptops", slug: "laptops" },
      { name: "Desktop Computers", slug: "desktop-computers" },
      { name: "Servers", slug: "servers" },
      { name: "TVs", slug: "tvs" },
      { name: "Audio & Music Equipment", slug: "audio-music" },
      { name: "Cameras", slug: "cameras" },
    ],
  },
  {
    name: "Properties",
    slug: "properties",
    children: [
      { name: "Houses & Apartments for Sale", slug: "houses-apartments-for-sale" },
      { name: "Houses & Apartments for Rent", slug: "houses-apartments-for-rent" },
      { name: "Land & Plots", slug: "land-plots" },
      { name: "Commercial Property", slug: "commercial-property" },
      { name: "Short Lets", slug: "short-lets" },
    ],
  },
  {
    name: "Fashion",
    slug: "fashion",
    children: [
      { name: "Men's Clothing", slug: "mens-clothing" },
      { name: "Women's Clothing", slug: "womens-clothing" },
      { name: "Shoes", slug: "shoes" },
      { name: "Bags", slug: "bags" },
      { name: "Watches & Jewellery", slug: "watches-jewellery" },
      { name: "Kids' Fashion", slug: "kids-fashion" },
    ],
  },
  {
    name: "Furniture & Appliances",
    slug: "furniture-appliances",
    children: [
      { name: "Furniture", slug: "furniture" },
      { name: "Kitchen Appliances", slug: "kitchen-appliances" },
      { name: "Home Appliances", slug: "home-appliances" },
      { name: "Home Décor", slug: "home-decor" },
      { name: "Generators", slug: "generators" },
    ],
  },
  {
    name: "Jobs",
    slug: "jobs",
    children: [
      { name: "Full-time Jobs", slug: "jobs-full-time" },
      { name: "Part-time Jobs", slug: "jobs-part-time" },
      { name: "Contract Jobs", slug: "jobs-contract" },
      { name: "Internships", slug: "jobs-internship" },
    ],
  },
  {
    name: "Beauty",
    slug: "beauty",
    children: [
      { name: "Skincare", slug: "skincare" },
      { name: "Hair Care", slug: "hair-care" },
      { name: "Makeup", slug: "makeup" },
      { name: "Fragrances", slug: "fragrances" },
    ],
  },
  {
    name: "Agriculture & Food",
    slug: "agriculture",
    children: [
      { name: "Farm Produce", slug: "farm-produce" },
      { name: "Livestock & Poultry", slug: "livestock-poultry" },
      { name: "Farming Equipment", slug: "farming-equipment" },
      { name: "Food & Groceries", slug: "food-groceries" },
    ],
  },
  {
    name: "Sports & Leisure",
    slug: "sports-leisure",
    children: [
      { name: "Sports Equipment", slug: "sports-equipment" },
      { name: "Fitness & Gym", slug: "fitness-gym" },
      { name: "Outdoor & Travel", slug: "outdoor-travel" },
      { name: "Games & Toys", slug: "games-toys" },
    ],
  },
  {
    name: "Art",
    slug: "art",
    children: [
      { name: "Paintings & Prints", slug: "paintings-prints" },
      { name: "Crafts & Handmade", slug: "crafts-handmade" },
      { name: "Photography", slug: "photography" },
      { name: "Antiques & Collectibles", slug: "antiques-collectibles" },
    ],
  },
];

async function main() {
  let parentsCreated = 0;
  let parentsExisting = 0;
  let childrenCreated = 0;
  let childrenExisting = 0;

  for (const parent of TREE) {
    const existingParent = await prisma.category.findUnique({ where: { slug: parent.slug } });
    let parentRow;
    if (existingParent) {
      // Preserve existing id; only correct name/parentId(=null) if drifted
      parentRow = await prisma.category.update({
        where: { slug: parent.slug },
        data: { name: parent.name, parentId: null },
      });
      parentsExisting++;
    } else {
      parentRow = await prisma.category.create({
        data: { name: parent.name, slug: parent.slug },
      });
      parentsCreated++;
      console.log(`+ parent created: ${parent.name} (${parent.slug})`);
    }

    for (const child of parent.children) {
      const existingChild = await prisma.category.findUnique({ where: { slug: child.slug } });
      if (existingChild) {
        // Re-parent if needed (covers earlier flat-seed entries) but never break a different valid parent
        if (existingChild.parentId !== parentRow.id) {
          await prisma.category.update({
            where: { id: existingChild.id },
            data: { parentId: parentRow.id, name: child.name },
          });
          console.log(`~ child re-parented: ${child.name} -> ${parent.slug}`);
        }
        childrenExisting++;
      } else {
        await prisma.category.create({
          data: { name: child.name, slug: child.slug, parentId: parentRow.id },
        });
        childrenCreated++;
        console.log(`+ child created: ${parent.slug} > ${child.name} (${child.slug})`);
      }
    }
  }

  console.log("\n=== Seed summary ===");
  console.log(`Parents:   created=${parentsCreated}, already-existed=${parentsExisting}`);
  console.log(`Children:  created=${childrenCreated}, already-existed=${childrenExisting}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
