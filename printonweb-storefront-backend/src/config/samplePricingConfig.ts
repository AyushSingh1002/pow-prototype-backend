import { PricingConfig } from "../modules/pricing/pricing.types";

export const samplePricingConfig: PricingConfig = {
  source: "SAMPLE: not PrintOnWeb pricing",
  version: "sample-v1",
  currency: "INR",
  isSample: true,
  products: {
    "business-cards": {
      productId: "business-cards",
      baseUnitPrice: 300, // 300 paise = INR 3.00
      minQuantity: 10,
      maxQuantity: 10000,
      setupFee: 15000, // 15000 paise = INR 150.00
      allowedOptions: {
        size: ["standard", "square", "slim"],
        stock: ["300gsm-matte", "350gsm-gloss", "400gsm-velvet"],
        sides: ["single", "double"],
        finish: ["none", "matte-lamination", "gloss-lamination", "spot-uv"],
      },
      incompatibleCombinations: [
        {
          options: { finish: "spot-uv", stock: "300gsm-matte" },
          reason: "Spot UV requires premium cardstock (350gsm-gloss or 400gsm-velvet).",
        },
      ],
      optionAdjustments: {
        size: {
          standard: { unitPriceDelta: 0 },
          square: { unitPriceDelta: 40 },
          slim: { unitPriceDelta: 20 },
        },
        stock: {
          "300gsm-matte": { unitPriceDelta: 0 },
          "350gsm-gloss": { unitPriceDelta: 50 },
          "400gsm-velvet": { unitPriceDelta: 120 },
        },
        sides: {
          single: { unitPriceDelta: 0 },
          double: { unitPriceDelta: 100, unitPriceMultiplier: 1.25 },
        },
        finish: {
          none: { unitPriceDelta: 0 },
          "matte-lamination": { unitPriceDelta: 60 },
          "gloss-lamination": { unitPriceDelta: 60 },
          "spot-uv": { unitPriceDelta: 150, flatFee: 5000 },
        },
      },
      quantityBreaks: [
        { minQuantity: 100, discountPercent: 5 },
        { minQuantity: 500, discountPercent: 12 },
        { minQuantity: 1000, discountPercent: 20 },
        { minQuantity: 5000, discountPercent: 30 },
      ],
    },

    "flyers-brochures": {
      productId: "flyers-brochures",
      baseUnitPrice: 450, // 450 paise = INR 4.50
      minQuantity: 10,
      maxQuantity: 25000,
      setupFee: 25000, // 25000 paise = INR 250.00
      allowedOptions: {
        size: ["a4", "a5", "dl"],
        stock: ["130gsm-gloss", "170gsm-matte", "300gsm-artcard"],
        sides: ["single", "double"],
        fold: ["none", "bi-fold", "tri-fold"],
      },
      incompatibleCombinations: [
        {
          options: { fold: "bi-fold", size: "a5" },
          reason: "Bi-fold is not supported on A5 size flyers (requires A4 or DL).",
        },
        {
          options: { fold: "tri-fold", size: "a5" },
          reason: "Tri-fold is not supported on A5 size flyers (requires A4 or DL).",
        },
      ],
      optionAdjustments: {
        size: {
          a5: { unitPriceDelta: -100 },
          a4: { unitPriceDelta: 0 },
          dl: { unitPriceDelta: -50 },
        },
        stock: {
          "130gsm-gloss": { unitPriceDelta: 0 },
          "170gsm-matte": { unitPriceDelta: 80 },
          "300gsm-artcard": { unitPriceDelta: 180 },
        },
        sides: {
          single: { unitPriceDelta: 0 },
          double: { unitPriceDelta: 120, unitPriceMultiplier: 1.3 },
        },
        fold: {
          none: { unitPriceDelta: 0 },
          "bi-fold": { unitPriceDelta: 40, flatFee: 4000 },
          "tri-fold": { unitPriceDelta: 60, flatFee: 6000 },
        },
      },
      quantityBreaks: [
        { minQuantity: 250, discountPercent: 8 },
        { minQuantity: 500, discountPercent: 15 },
        { minQuantity: 1000, discountPercent: 25 },
        { minQuantity: 5000, discountPercent: 35 },
      ],
    },

    "custom-stickers": {
      productId: "custom-stickers",
      baseUnitPrice: 600, // 600 paise = INR 6.00
      minQuantity: 10,
      maxQuantity: 5000,
      setupFee: 10000, // 10000 paise = INR 100.00
      allowedOptions: {
        size: ["2x2-inch", "3x3-inch", "4x4-inch"],
        material: ["vinyl-gloss", "vinyl-matte", "transparent"],
        cut: ["die-cut", "kiss-cut", "sheet"],
      },
      incompatibleCombinations: [
        {
          options: { material: "transparent", cut: "kiss-cut" },
          reason: "Transparent material requires die-cut or sheet cutting.",
        },
      ],
      optionAdjustments: {
        size: {
          "2x2-inch": { unitPriceDelta: 0 },
          "3x3-inch": { unitPriceDelta: 150 },
          "4x4-inch": { unitPriceDelta: 300 },
        },
        material: {
          "vinyl-gloss": { unitPriceDelta: 0 },
          "vinyl-matte": { unitPriceDelta: 40 },
          transparent: { unitPriceDelta: 120 },
        },
        cut: {
          "die-cut": { unitPriceDelta: 0 },
          "kiss-cut": { unitPriceDelta: 30 },
          sheet: { unitPriceDelta: -50 },
        },
      },
      quantityBreaks: [
        { minQuantity: 100, discountPercent: 10 },
        { minQuantity: 250, discountPercent: 18 },
        { minQuantity: 500, discountPercent: 25 },
        { minQuantity: 1000, discountPercent: 35 },
      ],
    },

    books: {
      productId: "books",
      baseUnitPrice: 29900, // 29900 paise = INR 299.00
      minQuantity: 1,
      maxQuantity: 2000,
      setupFee: 50000, // 50000 paise = INR 500.00
      allowedOptions: {
        size: ["a5-portrait", "a4-portrait", "custom-size"],
        interior: ["bw", "full-colour"],
        paper: ["natural-white", "bright-white", "art-matte"],
        binding: ["paperback", "hardcover", "spiral", "saddle-stitch"],
        pages: ["64", "120", "200", "320"],
        finish: ["matte", "gloss", "spot_uv", "foil"],
      },
      incompatibleCombinations: [
        {
          options: { binding: "saddle-stitch", size: "custom-size" },
          reason: "Saddle stitch is only supported on standard A4 and A5 sizes.",
        },
      ],
      optionAdjustments: {
        size: {
          "a5-portrait": { unitPriceDelta: 0 },
          "a4-portrait": { unitPriceDelta: 8000 },
          "custom-size": { unitPriceDelta: 5000 },
        },
        interior: {
          bw: { unitPriceDelta: 0 },
          "full-colour": { unitPriceDelta: 15000, unitPriceMultiplier: 1.3 },
        },
        paper: {
          "natural-white": { unitPriceDelta: 0 },
          "bright-white": { unitPriceDelta: 2000 },
          "art-matte": { unitPriceDelta: 4500 },
        },
        binding: {
          paperback: { unitPriceDelta: 0 },
          hardcover: { unitPriceDelta: 15000, flatFee: 30000 },
          spiral: { unitPriceDelta: 3000 },
          "saddle-stitch": { unitPriceDelta: -2000 },
        },
        pages: {
          "64": { unitPriceDelta: 768 },
          "120": { unitPriceDelta: 1440 },
          "200": { unitPriceDelta: 2400 },
          "320": { unitPriceDelta: 3840 },
        },
        finish: {
          matte: { unitPriceDelta: 0 },
          gloss: { unitPriceDelta: 1200 },
          spot_uv: { unitPriceDelta: 4500, flatFee: 4500 },
          foil: { unitPriceDelta: 6500, flatFee: 6500 },
        },
      },
      quantityBreaks: [
        { minQuantity: 5, discountPercent: 5 },
        { minQuantity: 10, discountPercent: 12 },
        { minQuantity: 25, discountPercent: 20 },
        { minQuantity: 50, discountPercent: 30 },
        { minQuantity: 100, discountPercent: 40 },
      ],
    },

    documents: {
      productId: "documents",
      baseUnitPrice: 4900, // 4900 paise = INR 49.00
      minQuantity: 1,
      maxQuantity: 10000,
      setupFee: 10000, // 10000 paise = INR 100.00
      allowedOptions: {
        size: ["a4", "a3", "letter"],
        interior: ["bw", "full-colour"],
        paper: ["75gsm", "100gsm", "120gsm"],
        binding: ["stapled", "spiral", "soft-cover", "none"],
      },
      optionAdjustments: {
        size: {
          a4: { unitPriceDelta: 0 },
          a3: { unitPriceDelta: 3000 },
          letter: { unitPriceDelta: 500 },
        },
        interior: {
          bw: { unitPriceDelta: 0 },
          "full-colour": { unitPriceDelta: 6000 },
        },
        paper: {
          "75gsm": { unitPriceDelta: 0 },
          "100gsm": { unitPriceDelta: 1500 },
          "120gsm": { unitPriceDelta: 2500 },
        },
        binding: {
          stapled: { unitPriceDelta: 500 },
          spiral: { unitPriceDelta: 2000 },
          "soft-cover": { unitPriceDelta: 4000 },
          none: { unitPriceDelta: 0 },
        },
      },
      quantityBreaks: [
        { minQuantity: 10, discountPercent: 5 },
        { minQuantity: 50, discountPercent: 15 },
        { minQuantity: 100, discountPercent: 25 },
        { minQuantity: 500, discountPercent: 35 },
      ],
    },

    certificates: {
      productId: "certificates",
      baseUnitPrice: 800, // INR 8.00
      minQuantity: 10,
      maxQuantity: 2500,
      setupFee: 10000,
      allowedOptions: {
        size: ["a4", "us-letter"],
        stock: ["parchment-180gsm", "linen-250gsm", "ivory-300gsm"],
        finish: ["none", "gold-foil", "silver-foil"],
      },
      optionAdjustments: {
        size: {
          a4: { unitPriceDelta: 0 },
          "us-letter": { unitPriceDelta: 50 },
        },
        stock: {
          "parchment-180gsm": { unitPriceDelta: 0 },
          "linen-250gsm": { unitPriceDelta: 200 },
          "ivory-300gsm": { unitPriceDelta: 300 },
        },
        finish: {
          none: { unitPriceDelta: 0 },
          "gold-foil": { unitPriceDelta: 500, flatFee: 5000 },
          "silver-foil": { unitPriceDelta: 500, flatFee: 5000 },
        },
      },
      quantityBreaks: [
        { minQuantity: 50, discountPercent: 10 },
        { minQuantity: 100, discountPercent: 20 },
        { minQuantity: 500, discountPercent: 35 },
      ],
    },

    posters: {
      productId: "posters",
      baseUnitPrice: 15000, // INR 150.00
      minQuantity: 1,
      maxQuantity: 500,
      setupFee: 15000,
      allowedOptions: {
        size: ["a3", "a2", "a1"],
        stock: ["170gsm-matte", "220gsm-satin", "300gsm-board"],
        finish: ["none", "matte-lamination", "gloss-lamination"],
      },
      optionAdjustments: {
        size: {
          a3: { unitPriceDelta: 0 },
          a2: { unitPriceDelta: 10000 },
          a1: { unitPriceDelta: 25000 },
        },
        stock: {
          "170gsm-matte": { unitPriceDelta: 0 },
          "220gsm-satin": { unitPriceDelta: 4000 },
          "300gsm-board": { unitPriceDelta: 8000 },
        },
        finish: {
          none: { unitPriceDelta: 0 },
          "matte-lamination": { unitPriceDelta: 3000 },
          "gloss-lamination": { unitPriceDelta: 3000 },
        },
      },
      quantityBreaks: [
        { minQuantity: 5, discountPercent: 10 },
        { minQuantity: 20, discountPercent: 20 },
        { minQuantity: 50, discountPercent: 30 },
      ],
    },

    letterheads: {
      productId: "letterheads",
      baseUnitPrice: 400, // INR 4.00
      minQuantity: 10,
      maxQuantity: 5000,
      setupFee: 10000,
      allowedOptions: {
        size: ["a4", "us-letter"],
        stock: ["100gsm-bond", "120gsm-smooth"],
      },
      optionAdjustments: {
        size: {
          a4: { unitPriceDelta: 0 },
          "us-letter": { unitPriceDelta: 20 },
        },
        stock: {
          "100gsm-bond": { unitPriceDelta: 0 },
          "120gsm-smooth": { unitPriceDelta: 80 },
        },
      },
      quantityBreaks: [
        { minQuantity: 100, discountPercent: 8 },
        { minQuantity: 500, discountPercent: 18 },
        { minQuantity: 1000, discountPercent: 28 },
      ],
    },

    "photo-albums": {
      productId: "photo-albums",
      baseUnitPrice: 99900, // INR 999.00
      minQuantity: 1,
      maxQuantity: 100,
      setupFee: 25000,
      allowedOptions: {
        size: ["8x8-square", "10x10-square", "11x8-landscape"],
        paper: ["luster-260gsm", "pearl-300gsm"],
        binding: ["hardcover-layflat"],
      },
      optionAdjustments: {
        size: {
          "8x8-square": { unitPriceDelta: 0 },
          "10x10-square": { unitPriceDelta: 30000 },
          "11x8-landscape": { unitPriceDelta: 25000 },
        },
        paper: {
          "luster-260gsm": { unitPriceDelta: 0 },
          "pearl-300gsm": { unitPriceDelta: 15000 },
        },
        binding: {
          "hardcover-layflat": { unitPriceDelta: 0 },
        },
      },
      quantityBreaks: [
        { minQuantity: 5, discountPercent: 10 },
        { minQuantity: 20, discountPercent: 25 },
      ],
    },

    calendars: {
      productId: "calendars",
      baseUnitPrice: 12000, // INR 120.00
      minQuantity: 10,
      maxQuantity: 2000,
      setupFee: 15000,
      allowedOptions: {
        type: ["desk-tent", "wall-hanging"],
        size: ["a5-landscape", "a4-portrait"],
        paper: ["170gsm-matte", "250gsm-art"],
      },
      optionAdjustments: {
        type: {
          "desk-tent": { unitPriceDelta: 0 },
          "wall-hanging": { unitPriceDelta: 3000 },
        },
        size: {
          "a5-landscape": { unitPriceDelta: 0 },
          "a4-portrait": { unitPriceDelta: 4000 },
        },
        paper: {
          "170gsm-matte": { unitPriceDelta: 0 },
          "250gsm-art": { unitPriceDelta: 2500 },
        },
      },
      quantityBreaks: [
        { minQuantity: 25, discountPercent: 10 },
        { minQuantity: 100, discountPercent: 22 },
        { minQuantity: 500, discountPercent: 35 },
      ],
    },
  },
};
