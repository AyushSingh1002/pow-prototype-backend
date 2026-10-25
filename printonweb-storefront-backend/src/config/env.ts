import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env if present
dotenv.config();

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalString = () =>
  z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = () =>
  z.preprocess(emptyToUndefined, z.string().url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    ENABLE_DEMO_MODE: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => {
        if (val === undefined) return false;
        if (typeof val === "boolean") return val;
        const normalized = val.trim().toLowerCase();
        return ["1", "true", "yes", "on"].includes(normalized);
      })
      .default(process.env.NODE_ENV !== "production"),
    PORT: z
      .string()
      .default("5000")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive()),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:5173,http://localhost:3000")
      .transform((val) => val.split(",").map((s) => s.trim()).filter(Boolean)),
    BACKEND_INTERNAL_URL: optionalUrl(),
    PRICING_CONFIG_VERSION: z.string().default("sample-v1"),
    QUOTE_TTL_MINUTES: z
      .string()
      .default("30")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive()),
    MAX_BODY_BYTES: z
      .string()
      .default("102400")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive()),
    RATE_LIMIT_WINDOW_MS: z
      .string()
      .default("60000")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive()),
    RATE_LIMIT_MAX_REQUESTS: z
      .string()
      .default("30")
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().positive()),
    DATABASE_URL: optionalString(),
    SUPABASE_URL: optionalUrl(),
    SUPABASE_ANON_KEY: optionalString(),
    STORAGE_BUCKET: optionalString(),
    STORAGE_REGION: optionalString(),
    STORAGE_ACCESS_KEY_ID: optionalString(),
    STORAGE_SECRET_ACCESS_KEY: optionalString(),
    STORAGE_ENDPOINT: optionalUrl(),
    PAYMENT_SECRET_KEY: optionalString(),
    PAYMENT_WEBHOOK_SECRET: optionalString(),
    PAYMENT_KEY_ID: optionalString(),
    FILE_SCAN_URL: optionalUrl(),
    FILE_SCAN_TOKEN: optionalString(),
    PREFLIGHT_SERVICE_URL: optionalUrl(),
    PREFLIGHT_SERVICE_TOKEN: optionalString(),
    MIN_PRINT_DPI: optionalString(),
    PRODUCTION_PRICING_CONFIG: optionalString(),
    PRODUCTION_CATALOGUE_CONFIG: optionalString(),
    TAX_RULES_CONFIG: optionalString(),
    SHIPPING_PROVIDER_URL: optionalUrl(),
    SHIPPING_PROVIDER_TOKEN: optionalString(),
    FULFILLMENT_WEBHOOK_URL: optionalUrl(),
    FULFILLMENT_WEBHOOK_TOKEN: optionalString(),
    LOG_SINK_URL: optionalUrl(),
    MONITORING_URL: optionalUrl(),
    BACKUP_RPO_HOURS: optionalString(),
    BACKUP_RTO_HOURS: optionalString(),
    CONTACT_DATA_RETENTION_DAYS: optionalString(),
    ARTWORK_RETENTION_DAYS: optionalString(),
    PRIVACY_POLICY_URL: optionalUrl(),
  })
  .superRefine((values, ctx) => {
    if (values.NODE_ENV === "production" || !values.ENABLE_DEMO_MODE) {
      if (values.NODE_ENV === "production" && values.ENABLE_DEMO_MODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ENABLE_DEMO_MODE"],
          message: "ENABLE_DEMO_MODE must be false in production.",
        });
      }

      if (!values.BACKEND_INTERNAL_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["BACKEND_INTERNAL_URL"],
          message:
            "BACKEND_INTERNAL_URL must be set to a valid http(s) URL before production startup.",
        });
      }

      if (!values.ALLOWED_ORIGINS.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALLOWED_ORIGINS"],
          message: "ALLOWED_ORIGINS must contain at least one trusted origin in production.",
        });
      }

      if (
        values.ALLOWED_ORIGINS.some((origin) =>
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALLOWED_ORIGINS"],
          message: "Localhost origins are not allowed when demo mode is disabled.",
        });
      }

      const productionRequirements: Array<[keyof EnvConfig, string | undefined]> = [
        ["DATABASE_URL", values.DATABASE_URL],
        ["SUPABASE_URL", values.SUPABASE_URL],
        ["SUPABASE_ANON_KEY", values.SUPABASE_ANON_KEY],
        ["PAYMENT_KEY_ID", values.PAYMENT_KEY_ID],
        ["PAYMENT_SECRET_KEY", values.PAYMENT_SECRET_KEY],
        ["PAYMENT_WEBHOOK_SECRET", values.PAYMENT_WEBHOOK_SECRET],
        ["STORAGE_BUCKET", values.STORAGE_BUCKET],
        ["STORAGE_REGION", values.STORAGE_REGION],
        ["STORAGE_ACCESS_KEY_ID", values.STORAGE_ACCESS_KEY_ID],
        ["STORAGE_SECRET_ACCESS_KEY", values.STORAGE_SECRET_ACCESS_KEY],
        ["STORAGE_ENDPOINT", values.STORAGE_ENDPOINT],
        ["FILE_SCAN_URL", values.FILE_SCAN_URL],
        ["FILE_SCAN_TOKEN", values.FILE_SCAN_TOKEN],
        ["PREFLIGHT_SERVICE_URL", values.PREFLIGHT_SERVICE_URL],
        ["PREFLIGHT_SERVICE_TOKEN", values.PREFLIGHT_SERVICE_TOKEN],
        ["MIN_PRINT_DPI", values.MIN_PRINT_DPI],
        ["PRODUCTION_PRICING_CONFIG", values.PRODUCTION_PRICING_CONFIG],
        ["PRODUCTION_CATALOGUE_CONFIG", values.PRODUCTION_CATALOGUE_CONFIG],
        ["TAX_RULES_CONFIG", values.TAX_RULES_CONFIG],
        ["SHIPPING_PROVIDER_URL", values.SHIPPING_PROVIDER_URL],
        ["SHIPPING_PROVIDER_TOKEN", values.SHIPPING_PROVIDER_TOKEN],
        ["FULFILLMENT_WEBHOOK_URL", values.FULFILLMENT_WEBHOOK_URL],
        ["FULFILLMENT_WEBHOOK_TOKEN", values.FULFILLMENT_WEBHOOK_TOKEN],
        ["LOG_SINK_URL", values.LOG_SINK_URL],
        ["MONITORING_URL", values.MONITORING_URL],
        ["BACKUP_RPO_HOURS", values.BACKUP_RPO_HOURS],
        ["BACKUP_RTO_HOURS", values.BACKUP_RTO_HOURS],
        ["CONTACT_DATA_RETENTION_DAYS", values.CONTACT_DATA_RETENTION_DAYS],
        ["ARTWORK_RETENTION_DAYS", values.ARTWORK_RETENTION_DAYS],
        ["PRIVACY_POLICY_URL", values.PRIVACY_POLICY_URL],
      ];

      for (const [key, value] of productionRequirements) {
        if (
          !value?.trim() ||
          /^(replace-me|your-|example|placeholder|changeme)/i.test(value.trim())
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must contain a real, non-placeholder value when demo mode is disabled.`,
          });
        }
      }

      for (const key of ["BACKUP_RPO_HOURS", "BACKUP_RTO_HOURS", "CONTACT_DATA_RETENTION_DAYS", "ARTWORK_RETENTION_DAYS", "MIN_PRINT_DPI"] as const) {
        const value = values[key];
        if (value && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must be a positive whole number.`,
          });
        }
      }

      if (values.PRODUCTION_PRICING_CONFIG) {
        try {
          const pricingConfig: unknown = JSON.parse(values.PRODUCTION_PRICING_CONFIG);
          if (
            !pricingConfig ||
            typeof pricingConfig !== "object" ||
            !("isSample" in pricingConfig) ||
            pricingConfig.isSample !== false
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["PRODUCTION_PRICING_CONFIG"],
              message: "Production pricing must be valid JSON marked isSample=false.",
            });
          }

          if (values.PRODUCTION_CATALOGUE_CONFIG) {
            try {
              const catalogueConfig: unknown = JSON.parse(values.PRODUCTION_CATALOGUE_CONFIG);
              if (
                !catalogueConfig ||
                typeof catalogueConfig !== "object" ||
                !("isSample" in catalogueConfig) ||
                catalogueConfig.isSample !== false
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["PRODUCTION_CATALOGUE_CONFIG"],
                  message: "Production catalogue must be valid JSON marked isSample=false.",
                });
              }
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["PRODUCTION_CATALOGUE_CONFIG"],
                message: "PRODUCTION_CATALOGUE_CONFIG must contain valid JSON.",
              });
            }
          }
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["PRODUCTION_PRICING_CONFIG"],
            message: "PRODUCTION_PRICING_CONFIG must contain valid JSON.",
          });
        }
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("FATAL: Environment configuration validation failed:");
    for (const issue of error.issues) {
      console.error(` - [${issue.path.join(".")}] ${issue.message}`);
    }
  } else {
    console.error("FATAL: Unexpected error parsing environment config:", error);
  }
  process.exit(1);
}

export const env = parsedEnv;
