import { Product, PrintOption } from "./catalogue.types";

export const sampleProducts: Product[] = [
  {
    id: "business-cards",
    slug: "business-cards",
    name: "Premium Visiting Cards",
    category: "stationery",
    description: "Standard 3.5x2 inch high-definition visiting cards on premium stock with optional lamination and spot UV.",
    isActive: true,
    minQuantity: 50,
    maxQuantity: 10000,
    sampleStartingPrice: 300, // 300 paise
    currency: "INR",
    isSample: true,
  },
  {
    id: "flyers-brochures",
    slug: "flyers-brochures",
    name: "Marketing Flyers & Leaflets",
    category: "marketing",
    description: "Full-color promotional flyers printed on crisp gloss or matte paper, available with bi-fold or tri-fold.",
    isActive: true,
    minQuantity: 100,
    maxQuantity: 25000,
    sampleStartingPrice: 450, // 450 paise
    currency: "INR",
    isSample: true,
  },
  {
    id: "custom-stickers",
    slug: "custom-stickers",
    name: "Custom Die-Cut Vinyl Stickers",
    category: "labels",
    description: "Weather-resistant custom cut vinyl stickers on white or transparent stock with vibrant pigment inks.",
    isActive: true,
    minQuantity: 25,
    maxQuantity: 5000,
    sampleStartingPrice: 600, // 600 paise
    currency: "INR",
    isSample: true,
  },
  {
    id: "books",
    slug: "books",
    name: "Custom Books & Notebooks",
    category: "books",
    description: "Paperback & hardcover custom bound books with vivid colour or black-and-white printing.",
    isActive: true,
    minQuantity: 1,
    maxQuantity: 2000,
    sampleStartingPrice: 29900, // 29900 paise = ₹299
    currency: "INR",
    isSample: true,
  },
  {
    id: "documents",
    slug: "documents",
    name: "Documents & Reports",
    category: "documents",
    description: "High-speed document printing for reports, manuals, assignments, and presentations.",
    isActive: true,
    minQuantity: 1,
    maxQuantity: 10000,
    sampleStartingPrice: 4900, // 4900 paise = ₹49
    currency: "INR",
    isSample: true,
  },
  {
    id: "certificates",
    slug: "certificates",
    name: "Certificates & Diplomas",
    category: "stationery",
    description: "Official award & achievement certificates printed on premium parchment, linen or heavy ivory art card.",
    isActive: true,
    minQuantity: 10,
    maxQuantity: 2500,
    sampleStartingPrice: 800, // 800 paise = ₹8
    currency: "INR",
    isSample: true,
  },
  {
    id: "posters",
    slug: "posters",
    name: "Large-Format Posters",
    category: "marketing",
    description: "High-definition large-format art & promotional posters on satin photo paper or presentation matte.",
    isActive: true,
    minQuantity: 1,
    maxQuantity: 500,
    sampleStartingPrice: 15000, // 15000 paise = ₹150
    currency: "INR",
    isSample: true,
  },
  {
    id: "letterheads",
    slug: "letterheads",
    name: "Corporate Letterheads",
    category: "stationery",
    description: "Laser & inkjet friendly official stationery printed on executive watermark bond or ultra-smooth card.",
    isActive: true,
    minQuantity: 50,
    maxQuantity: 5000,
    sampleStartingPrice: 400, // 400 paise = ₹4
    currency: "INR",
    isSample: true,
  },
  {
    id: "photo-albums",
    slug: "photo-albums",
    name: "Custom Photo Albums",
    category: "books",
    description: "Seamless panoramic layflat hardcover photo books printed on archival photographic luster paper.",
    isActive: true,
    minQuantity: 1,
    maxQuantity: 100,
    sampleStartingPrice: 99900, // 99900 paise = ₹999
    currency: "INR",
    isSample: true,
  },
  {
    id: "calendars",
    slug: "calendars",
    name: "Desk & Wall Calendars",
    category: "stationery",
    description: "Custom multi-month desk tent easel and hanging wall calendars with wire-o spiral binding.",
    isActive: true,
    minQuantity: 10,
    maxQuantity: 2000,
    sampleStartingPrice: 12000, // 12000 paise = ₹120
    currency: "INR",
    isSample: true,
  },
];

export const samplePrintOptions: PrintOption[] = [
  // Business cards options
  {
    id: "bc-size",
    productId: "business-cards",
    code: "size",
    name: "Card Dimensions",
    type: "size",
    choices: [
      { value: "standard", label: "Standard (3.5 x 2 in)" },
      { value: "square", label: "Square (2.5 x 2.5 in)" },
      { value: "slim", label: "Slim Profile (3.5 x 1.5 in)" },
    ],
  },
  {
    id: "bc-stock",
    productId: "business-cards",
    code: "stock",
    name: "Paper Stock",
    type: "stock",
    choices: [
      { value: "300gsm-matte", label: "300 GSM Matte Art Card" },
      { value: "350gsm-gloss", label: "350 GSM Gloss Premium" },
      { value: "400gsm-velvet", label: "400 GSM Velvet Soft-Touch" },
    ],
  },
  {
    id: "bc-sides",
    productId: "business-cards",
    code: "sides",
    name: "Print Sides",
    type: "sides",
    choices: [
      { value: "single", label: "Single-Sided Print" },
      { value: "double", label: "Double-Sided Print" },
    ],
  },
  {
    id: "bc-finish",
    productId: "business-cards",
    code: "finish",
    name: "Surface Coating",
    type: "finish",
    choices: [
      { value: "none", label: "No Extra Coating" },
      { value: "matte-lamination", label: "Thermal Matte Lamination" },
      { value: "gloss-lamination", label: "Gloss Lamination" },
      { value: "spot-uv", label: "Raised Spot UV Gloss" },
    ],
  },

  // Flyers & Brochures options
  {
    id: "fb-size",
    productId: "flyers-brochures",
    code: "size",
    name: "Flyer Dimensions",
    type: "size",
    choices: [
      { value: "a4", label: "A4 (210 x 297 mm)" },
      { value: "a5", label: "A5 (148 x 210 mm)" },
      { value: "dl", label: "DL Enclosure (99 x 210 mm)" },
    ],
  },
  {
    id: "fb-stock",
    productId: "flyers-brochures",
    code: "stock",
    name: "Paper Weight",
    type: "stock",
    choices: [
      { value: "130gsm-gloss", label: "130 GSM Gloss Art Paper" },
      { value: "170gsm-matte", label: "170 GSM Matte Art Paper" },
      { value: "300gsm-artcard", label: "300 GSM Heavy Art Card" },
    ],
  },
  {
    id: "fb-sides",
    productId: "flyers-brochures",
    code: "sides",
    name: "Print Sides",
    type: "sides",
    choices: [
      { value: "single", label: "Single-Sided Print" },
      { value: "double", label: "Double-Sided Print" },
    ],
  },
  {
    id: "fb-fold",
    productId: "flyers-brochures",
    code: "fold",
    name: "Creasing & Folding",
    type: "fold",
    choices: [
      { value: "none", label: "Flat (No Fold)" },
      { value: "bi-fold", label: "Half Fold (4 Panels)" },
      { value: "tri-fold", label: "C-Fold / Z-Fold (6 Panels)" },
    ],
  },

  // Custom Stickers options
  {
    id: "cs-size",
    productId: "custom-stickers",
    code: "size",
    name: "Sticker Size",
    type: "size",
    choices: [
      { value: "2x2-inch", label: "2 x 2 inches" },
      { value: "3x3-inch", label: "3 x 3 inches" },
      { value: "4x4-inch", label: "4 x 4 inches" },
    ],
  },
  {
    id: "cs-material",
    productId: "custom-stickers",
    code: "material",
    name: "Base Material",
    type: "material",
    choices: [
      { value: "vinyl-gloss", label: "White Gloss Vinyl" },
      { value: "vinyl-matte", label: "White Matte Vinyl" },
      { value: "transparent", label: "Clear Transparent Film" },
    ],
  },
  {
    id: "cs-cut",
    productId: "custom-stickers",
    code: "cut",
    name: "Finishing Cut",
    type: "cut",
    choices: [
      { value: "die-cut", label: "Individual Custom Die-Cut" },
      { value: "kiss-cut", label: "Easy-Peel Kiss-Cut" },
      { value: "sheet", label: "Sticker Sheet Layout" },
    ],
  },

  // Books options
  {
    id: "book-size",
    productId: "books",
    code: "size",
    name: "Trim Size",
    type: "size",
    choices: [
      { value: "a5-portrait", label: "A5 Portrait (148 × 210 mm)" },
      { value: "a4-portrait", label: "A4 Portrait (210 × 297 mm)" },
      { value: "custom-size", label: "Custom Digest (135 × 216 mm)" },
    ],
  },
  {
    id: "book-interior",
    productId: "books",
    code: "interior",
    name: "Interior Color",
    type: "interior",
    choices: [
      { value: "bw", label: "Black & White (Monochrome)" },
      { value: "full-colour", label: "Full Colour (High Gamut)" },
    ],
  },
  {
    id: "book-paper",
    productId: "books",
    code: "paper",
    name: "Paper Stock",
    type: "stock",
    choices: [
      { value: "natural-white", label: "80 GSM Natural White" },
      { value: "bright-white", label: "100 GSM Bright White" },
      { value: "art-matte", label: "130 GSM Art Matte" },
    ],
  },
  {
    id: "book-binding",
    productId: "books",
    code: "binding",
    name: "Binding Style",
    type: "binding",
    choices: [
      { value: "paperback", label: "Paperback (Perfect Bound)" },
      { value: "hardcover", label: "Hardcover (Casebound)" },
      { value: "spiral", label: "Spiral / Wiro Bound" },
      { value: "saddle-stitch", label: "Saddle Stitch" },
    ],
  },

  // Documents options
  {
    id: "doc-size",
    productId: "documents",
    code: "size",
    name: "Page Size",
    type: "size",
    choices: [
      { value: "a4", label: "A4 Standard (210 × 297 mm)" },
      { value: "a3", label: "A3 Large (297 × 420 mm)" },
      { value: "letter", label: "US Letter (8.5 × 11 in)" },
    ],
  },
  {
    id: "doc-interior",
    productId: "documents",
    code: "interior",
    name: "Print Mode",
    type: "interior",
    choices: [
      { value: "bw", label: "Black & White" },
      { value: "full-colour", label: "Full Colour" },
    ],
  },
  {
    id: "doc-paper",
    productId: "documents",
    code: "paper",
    name: "Paper Weight",
    type: "stock",
    choices: [
      { value: "75gsm", label: "75 GSM Everyday Bond" },
      { value: "100gsm", label: "100 GSM Premium Smooth" },
      { value: "120gsm", label: "120 GSM Executive Heavy" },
    ],
  },
  {
    id: "doc-binding",
    productId: "documents",
    code: "binding",
    name: "Binding / Finishing",
    type: "binding",
    choices: [
      { value: "stapled", label: "Corner / Side Stapled" },
      { value: "spiral", label: "Spiral Wiro Bound" },
      { value: "soft-cover", label: "Soft Thermal Cover" },
      { value: "none", label: "Loose Sheets (Unbound)" },
    ],
  },

  // Certificates options
  {
    id: "cert-size",
    productId: "certificates",
    code: "size",
    name: "Certificate Dimensions",
    type: "size",
    choices: [
      { value: "a4", label: "A4 Standard (210 × 297 mm)" },
      { value: "us-letter", label: "US Letter (8.5 × 11 in)" },
    ],
  },
  {
    id: "cert-stock",
    productId: "certificates",
    code: "stock",
    name: "Certificate Stock",
    type: "stock",
    choices: [
      { value: "parchment-180gsm", label: "180 GSM Natural Parchment" },
      { value: "linen-250gsm", label: "250 GSM Premium Linen Finish" },
      { value: "ivory-300gsm", label: "300 GSM Heavyweight Ivory Art" },
    ],
  },
  {
    id: "cert-finish",
    productId: "certificates",
    code: "finish",
    name: "Embossing & Foil Seal",
    type: "finish",
    choices: [
      { value: "none", label: "Standard Ink Only" },
      { value: "gold-foil", label: "Embossed Gold Foil Seal" },
      { value: "silver-foil", label: "Embossed Silver Foil Seal" },
    ],
  },

  // Posters options
  {
    id: "poster-size",
    productId: "posters",
    code: "size",
    name: "Poster Dimensions",
    type: "size",
    choices: [
      { value: "a3", label: "A3 Mini (297 × 420 mm)" },
      { value: "a2", label: "A2 Standard (420 × 594 mm)" },
      { value: "a1", label: "A1 Large Format (594 × 841 mm)" },
    ],
  },
  {
    id: "poster-stock",
    productId: "posters",
    code: "stock",
    name: "Paper Stock",
    type: "stock",
    choices: [
      { value: "170gsm-matte", label: "170 GSM Presentation Matte" },
      { value: "220gsm-satin", label: "220 GSM Satin Photo Lustre" },
      { value: "300gsm-board", label: "300 GSM Heavy Display Board" },
    ],
  },
  {
    id: "poster-finish",
    productId: "posters",
    code: "finish",
    name: "Protective Coating",
    type: "finish",
    choices: [
      { value: "none", label: "Uncoated Surface" },
      { value: "matte-lamination", label: "Anti-Glare Matte Lamination" },
      { value: "gloss-lamination", label: "High-Vibrancy Gloss Lamination" },
    ],
  },

  // Letterheads options
  {
    id: "lh-size",
    productId: "letterheads",
    code: "size",
    name: "Sheet Dimensions",
    type: "size",
    choices: [
      { value: "a4", label: "A4 Standard (210 × 297 mm)" },
      { value: "us-letter", label: "US Letter (8.5 × 11 in)" },
    ],
  },
  {
    id: "lh-stock",
    productId: "letterheads",
    code: "stock",
    name: "Paper Stock",
    type: "stock",
    choices: [
      { value: "100gsm-bond", label: "100 GSM Executive Watermark Bond" },
      { value: "120gsm-smooth", label: "120 GSM Ultra Smooth Superfine" },
    ],
  },

  // Photo Albums options
  {
    id: "pa-size",
    productId: "photo-albums",
    code: "size",
    name: "Album Format",
    type: "size",
    choices: [
      { value: "8x8-square", label: "8 × 8 in Square" },
      { value: "10x10-square", label: "10 × 10 in Square" },
      { value: "11x8-landscape", label: "11 × 8.5 in Landscape" },
    ],
  },
  {
    id: "pa-paper",
    productId: "photo-albums",
    code: "paper",
    name: "Archival Paper",
    type: "stock",
    choices: [
      { value: "luster-260gsm", label: "260 GSM Professional Luster" },
      { value: "pearl-300gsm", label: "300 GSM Archival Pearl" },
    ],
  },
  {
    id: "pa-binding",
    productId: "photo-albums",
    code: "binding",
    name: "Binding Style",
    type: "binding",
    choices: [
      { value: "hardcover-layflat", label: "Seamless Panoramic Layflat Hardcover" },
    ],
  },

  // Calendars options
  {
    id: "cal-type",
    productId: "calendars",
    code: "type",
    name: "Calendar Format",
    type: "binding",
    choices: [
      { value: "desk-tent", label: "Desk Tent Easel (12 Months)" },
      { value: "wall-hanging", label: "Wall Hanging Wire-O (12 Months)" },
    ],
  },
  {
    id: "cal-size",
    productId: "calendars",
    code: "size",
    name: "Calendar Size",
    type: "size",
    choices: [
      { value: "a5-landscape", label: "A5 Landscape" },
      { value: "a4-portrait", label: "A4 Portrait" },
    ],
  },
  {
    id: "cal-paper",
    productId: "calendars",
    code: "paper",
    name: "Page Stock",
    type: "stock",
    choices: [
      { value: "170gsm-matte", label: "170 GSM Matte Card" },
      { value: "250gsm-art", label: "250 GSM Silk Artboard" },
    ],
  },
];
