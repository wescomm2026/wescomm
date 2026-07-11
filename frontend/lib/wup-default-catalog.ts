const SHOP_ASSET_BASE = "/assets/wup shop assets";

export type WupDefaultProductTemplate = {
  id: string;
  name: string;
  categoryName: string;
  description: string;
  imageUrl: string;
  price: number;
  stock: number;
  lowStockThreshold: number;
  source: "asset" | "price-list";
};

export const WUP_DEFAULT_PRODUCT_TEMPLATES: WupDefaultProductTemplate[] = [
  {
    id: "elem-pe-shirt",
    name: "Elementary PE Shirt",
    categoryName: "Uniforms",
    description: "Elementary PE T-shirt, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe shirt.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "elem-pe-pants",
    name: "Elementary PE Jogging Pants",
    categoryName: "Uniforms",
    description: "Elementary PE jogging pants, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe pants.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "elem-pe-set",
    name: "Elementary PE Uniform Set",
    categoryName: "Uniforms",
    description: "Elementary PE shirt and jogging pants set",
    imageUrl: `${SHOP_ASSET_BASE}/elem pe set.png`,
    price: 650,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "college-pe-shirt",
    name: "PE Uniform Top",
    categoryName: "Uniforms",
    description: "College PE T-shirt, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-top.png`,
    price: 350,
    stock: 30,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "college-pe-pants",
    name: "PE Uniform Pants",
    categoryName: "Uniforms",
    description: "College PE jogging pants, all sizes",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-pants.png`,
    price: 400,
    stock: 30,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "college-pe-set",
    name: "PE Uniform Set",
    categoryName: "Uniforms",
    description: "College PE shirt and jogging pants set",
    imageUrl: `${SHOP_ASSET_BASE}/pe-uniform-set.png`,
    price: 750,
    stock: 30,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-boys-polo",
    name: "Senior High Boys Polo",
    categoryName: "Uniforms",
    description: "Senior High boys uniform polo",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys polo.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-boys-pants",
    name: "Senior High Boys Pants",
    categoryName: "Uniforms",
    description: "Senior High boys uniform pants",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys pants.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-boys-set",
    name: "Senior High Boys Uniform Set",
    categoryName: "Uniforms",
    description: "Senior High boys polo and pants set",
    imageUrl: `${SHOP_ASSET_BASE}/senior high boys set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-girls-top",
    name: "Senior High Girls Top",
    categoryName: "Uniforms",
    description: "Senior High girls uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/senior high top girl.png`,
    price: 300,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-girls-skirt",
    name: "Senior High Girls Skirt",
    categoryName: "Uniforms",
    description: "Senior High girls uniform skirt",
    imageUrl: `${SHOP_ASSET_BASE}/senior high palda girl.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "senior-high-girls-set",
    name: "Senior High Girls Uniform Set",
    categoryName: "Uniforms",
    description: "Senior High girls top and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/senior high uniform set girl.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "boys-wup-uniform",
    name: "Boys WUP Uniform",
    categoryName: "Uniforms",
    description: "WUP boys uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/boys-wup-uniform.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "boys-wup-uniform-set",
    name: "Boys WUP Uniform Set",
    categoryName: "Uniforms",
    description: "WUP boys uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/boys-wup-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-girls-uniform-set",
    name: "WUP Girls Uniform Set",
    categoryName: "Uniforms",
    description: "WUP girls blouse and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-girls-blouse",
    name: "WUP Girls Blouse",
    categoryName: "Uniforms",
    description: "WUP girls blouse with ribbon",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-blouse-ribbon.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-girls-blouse-classic",
    name: "WUP Girls Blouse Classic",
    categoryName: "Uniforms",
    description: "WUP girls classic blouse",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-blouse.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-girls-skirt",
    name: "WUP Girls Skirt",
    categoryName: "Uniforms",
    description: "WUP girls uniform skirt",
    imageUrl: `${SHOP_ASSET_BASE}/wup-girls-skirt.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-slacks",
    name: "WUP Slacks",
    categoryName: "Uniforms",
    description: "WUP uniform slacks",
    imageUrl: `${SHOP_ASSET_BASE}/wup-slacks.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "bsba-girls-uniform-set",
    name: "BSBA Girls Uniform Set",
    categoryName: "Uniforms",
    description: "BSBA blouse and skirt set",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM SET.png`,
    price: 700,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "bsba-girls-uniform",
    name: "BSBA Girls Uniform",
    categoryName: "Uniforms",
    description: "BSBA blouse uniform",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA GIRL UNIFORM.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "bsba-skirt",
    name: "BSBA Skirt",
    categoryName: "Uniforms",
    description: "BSBA green skirt",
    imageUrl: `${SHOP_ASSET_BASE}/BSBA SKIRT.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-girls-uniform",
    name: "Nursing Girls Uniform",
    categoryName: "Uniforms",
    description: "Nursing girls yellow uniform dress",
    imageUrl: `${SHOP_ASSET_BASE}/chtm-dress-uniform.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-crim-uniform",
    name: "WUP Criminology Uniform",
    categoryName: "Uniforms",
    description: "WUP criminology uniform",
    imageUrl: `${SHOP_ASSET_BASE}/wup crim uniform.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-uniform-set",
    name: "Nursing Uniform Set",
    categoryName: "Uniforms",
    description: "Nursing uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-boys-uniform-set",
    name: "Nursing Boys Uniform Set",
    categoryName: "Uniforms",
    description: "Nursing boys uniform set",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-boys-uniform-set.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-clinical-top",
    name: "Nursing Clinical Top",
    categoryName: "Uniforms",
    description: "Nursing clinical uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-clinical-top.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-slacks",
    name: "Nursing Slacks",
    categoryName: "Uniforms",
    description: "Nursing uniform slacks",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-slacks.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "nursing-smock-gown",
    name: "Nursing Smock Gown",
    categoryName: "Uniforms",
    description: "Nursing clinical smock gown",
    imageUrl: `${SHOP_ASSET_BASE}/nursing-smock-gown.png`,
    price: 600,
    stock: 18,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "med-tech-uniform-set",
    name: "Med Tech Uniform Set",
    categoryName: "Uniforms",
    description: "Med Tech top and pants set",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM SET.png`,
    price: 600,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "med-tech-uniform-top",
    name: "Med Tech Uniform Top",
    categoryName: "Uniforms",
    description: "Med Tech white uniform top",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM.png`,
    price: 350,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "med-tech-uniform-pants",
    name: "Med Tech Uniform Pants",
    categoryName: "Uniforms",
    description: "Med Tech uniform pants",
    imageUrl: `${SHOP_ASSET_BASE}/MED TECH UNIFORM PANTS.png`,
    price: 400,
    stock: 24,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wesleyan-id-lace",
    name: "Wesleyan ID Lace",
    categoryName: "ID Accessories",
    description: "University ID lace",
    imageUrl: `${SHOP_ASSET_BASE}/wesleyan-id-lace-new.png`,
    price: 175,
    stock: 50,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "wup-black-id-lace",
    name: "WUP Black ID Lace",
    categoryName: "ID Accessories",
    description: "Black WUP ID lace",
    imageUrl: `${SHOP_ASSET_BASE}/wup-black-id-lace.png`,
    price: 175,
    stock: 50,
    lowStockThreshold: 10,
    source: "asset"
  },
  {
    id: "principles-med-lab-science-1",
    name: "Principles of Medical Laboratory Science 1",
    categoryName: "Textbooks",
    description: "Medical Laboratory Science textbook",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_22 PM (1).png`,
    price: 645,
    stock: 12,
    lowStockThreshold: 5,
    source: "asset"
  },
  {
    id: "drug-guide-nurses-clinicians",
    name: "Drug Guide for Nurses and Clinicians",
    categoryName: "Textbooks",
    description: "Nursing drug guide reference book",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_22 PM (2).png`,
    price: 900,
    stock: 12,
    lowStockThreshold: 5,
    source: "asset"
  },
  {
    id: "fundamentals-nursing-vol-1",
    name: "Fundamentals of Nursing Volume 1",
    categoryName: "Textbooks",
    description: "Fundamentals of Nursing textbook, volume 1",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (3).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5,
    source: "asset"
  },
  {
    id: "fundamentals-nursing-vol-2",
    name: "Fundamentals of Nursing Volume 2",
    categoryName: "Textbooks",
    description: "Fundamentals of Nursing textbook, volume 2",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (4).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5,
    source: "asset"
  },
  {
    id: "kozier-erb-nursing-methods",
    name: "Kozier and Erb's Nursing Methods Reference",
    categoryName: "Textbooks",
    description: "Nursing methods reference book",
    imageUrl: `${SHOP_ASSET_BASE}/ChatGPT Image Jul 10, 2026, 12_06_23 PM (5).png`,
    price: 1070,
    stock: 12,
    lowStockThreshold: 5,
    source: "asset"
  },
  {
    id: "elementary-cloth-pack",
    name: "Elementary Cloth Pack",
    categoryName: "Uniforms",
    description: "Elementary uniform cloth pack",
    imageUrl: "",
    price: 550,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "jhs-cloth-mf",
    name: "JHS Cloth M/F",
    categoryName: "Uniforms",
    description: "Junior High School uniform cloth pack",
    imageUrl: "",
    price: 550,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "shs-female-cloth",
    name: "SHS Female Cloth",
    categoryName: "Uniforms",
    description: "Senior High School female cloth pack",
    imageUrl: "",
    price: 550,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "shs-male-cloth",
    name: "SHS Male Cloth",
    categoryName: "Uniforms",
    description: "Senior High School male cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "college-cloth-mf",
    name: "College Cloth M/F",
    categoryName: "Uniforms",
    description: "College uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "nursing-cloth-mf",
    name: "Nursing Cloth M/F",
    categoryName: "Uniforms",
    description: "Nursing uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "medtech-cloth-mf",
    name: "MedTech F/M Cloth",
    categoryName: "Uniforms",
    description: "Medical Technology uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "radtech-cloth-mf",
    name: "RadTech F/M Cloth",
    categoryName: "Uniforms",
    description: "Radiologic Technology uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "physical-therapy-cloth-mf",
    name: "Physical Therapy F/M Cloth",
    categoryName: "Uniforms",
    description: "Physical Therapy uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "pharma-cloth-mf",
    name: "Pharma Cloth M/F",
    categoryName: "Uniforms",
    description: "Pharmacy uniform cloth pack",
    imageUrl: "",
    price: 600,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "top-cloth-125",
    name: "Top Cloth 1.25 Yards",
    categoryName: "Uniforms",
    description: "Top cloth only, small to semi-medium",
    imageUrl: "",
    price: 300,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "top-cloth-150",
    name: "Top Cloth 1.50 Yards",
    categoryName: "Uniforms",
    description: "Top cloth only, medium to large",
    imageUrl: "",
    price: 350,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "top-cloth-175",
    name: "Top Cloth 1.75 Yards",
    categoryName: "Uniforms",
    description: "Top cloth only, XL and above",
    imageUrl: "",
    price: 400,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "cba-corpo-boys",
    name: "CBA Corpo Boys",
    categoryName: "Uniforms",
    description: "CBA corporate uniform for boys",
    imageUrl: "",
    price: 700,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "cba-corpo-girls",
    name: "CBA Corpo Girls",
    categoryName: "Uniforms",
    description: "CBA corporate uniform for girls",
    imageUrl: "",
    price: 700,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "wup-pin",
    name: "WUP Pin",
    categoryName: "ID Accessories",
    description: "Wesleyan University pin",
    imageUrl: "",
    price: 110,
    stock: 0,
    lowStockThreshold: 10,
    source: "price-list"
  },
  {
    id: "exploring-childrens-literature",
    name: "Exploring Children's Literature",
    categoryName: "Textbooks",
    description: "Education textbook",
    imageUrl: "",
    price: 440,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "observations-teaching-learning",
    name: "Observations of Teaching-Learning",
    categoryName: "Textbooks",
    description: "Education textbook",
    imageUrl: "",
    price: 450,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "participation-teaching-assistantship",
    name: "Participation and Teaching Assistantship",
    categoryName: "Textbooks",
    description: "Education textbook",
    imageUrl: "",
    price: 450,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "teacher-school-curriculum",
    name: "Teacher and the School Curriculum",
    categoryName: "Textbooks",
    description: "Education textbook",
    imageUrl: "",
    price: 375,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "applied-business-tech-hrm",
    name: "Applied Business and Technology in HRM",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 315,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "entrepreneurship-tourism-hospitality",
    name: "Entrepreneurship in Tourism and Hospitality",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 350,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "financial-lodging-operations",
    name: "Financial Management in Lodging Operations",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 430,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "heritage-tourism",
    name: "Heritage Tourism",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 370,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "intro-mice",
    name: "Introduction to MICE",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 415,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "legal-aspects-tourism",
    name: "Legal Aspects in Tourism",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 645,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "phil-tourism-geography-culture",
    name: "Philippine Tourism, Geography and Culture",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 420,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "marketing-tourism-hospitality",
    name: "Marketing Presentation of Tourism and Hospitality",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 425,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "rizal-life-works-writings",
    name: "Rizal Life, Works and Writings",
    categoryName: "Textbooks",
    description: "General education textbook",
    imageUrl: "",
    price: 350,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "supply-chain-management",
    name: "Supply Chain Management",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 310,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "the-contemporary-world",
    name: "The Contemporary World",
    categoryName: "Textbooks",
    description: "General education textbook",
    imageUrl: "",
    price: 350,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "tour-travel-management",
    name: "Tour and Travel Management",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 450,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "tourism-hospitality-marketing",
    name: "Tourism and Hospitality Marketing",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 305,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  },
  {
    id: "transportation-management",
    name: "Transportation Management",
    categoryName: "Textbooks",
    description: "CHTM textbook",
    imageUrl: "",
    price: 310,
    stock: 0,
    lowStockThreshold: 5,
    source: "price-list"
  }
];

export const WUP_ASSET_PRODUCT_TEMPLATES = WUP_DEFAULT_PRODUCT_TEMPLATES.filter((item) => item.source === "asset");
