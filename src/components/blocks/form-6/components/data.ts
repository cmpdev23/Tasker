export type VerificationSectionId = "business" | "public" | "management"

export type VerificationSelectOption = {
  value: string
  label: string
}

export type BusinessDetails = {
  legalName: string
  businessType: string
  website: string
  addressLine1: string
  city: string
  region: string
  postalCode: string
  country: string
  taxId: string
  industry: string
  productDescription: string
}

export type PublicDetails = {
  publicName: string
  supportPhone: string
  supportEmail: string
  statementDescriptor: string
  website: string
  supportUrl: string
  customerSupportNote: string
}

export type ManagementDetails = {
  representativeName: string
  representativeRole: string
  representativeEmail: string
  dateOfBirth: string
  addressLine1: string
  city: string
  region: string
  postalCode: string
  country: string
  phone: string
  ssnLast4: string
  ownerName: string
  ownerRole: string
  ownerEmail: string
  ownerStatus: string
}

export type VerificationProfile = {
  business: BusinessDetails
  publicProfile: PublicDetails
  management: ManagementDetails
}

export const BUSINESS_TYPE_OPTIONS: VerificationSelectOption[] = [
  { value: "llc", label: "Limited liability company" },
  { value: "corporation", label: "Corporation" },
  { value: "sole-proprietor", label: "Sole proprietor" },
  { value: "nonprofit", label: "Nonprofit organization" },
]

export const INDUSTRY_OPTIONS: VerificationSelectOption[] = [
  { value: "digital-services", label: "Digital services" },
  { value: "professional-services", label: "Professional services" },
  { value: "education", label: "Education and training" },
  { value: "retail", label: "Retail goods" },
]

export const COUNTRY_OPTIONS: VerificationSelectOption[] = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "AU", label: "Australia" },
]

export const REPRESENTATIVE_ROLE_OPTIONS: VerificationSelectOption[] = [
  { value: "executive-owner", label: "Executive, owner, and representative" },
  { value: "executive", label: "Executive" },
  { value: "owner", label: "Owner" },
  { value: "representative", label: "Account representative" },
]

export const OWNER_STATUS_OPTIONS: VerificationSelectOption[] = [
  { value: "provided", label: "Information provided" },
  { value: "needs-review", label: "Needs review" },
  { value: "verified", label: "Verified" },
]

export const DEFAULT_VERIFICATION_PROFILE: VerificationProfile = {
  business: {
    legalName: "Cedar & Volt Studio LLC",
    businessType: "llc",
    website: "https://cedarvolt.studio",
    addressLine1: "418 Market Street, Floor 6",
    city: "Portland",
    region: "OR",
    postalCode: "97205",
    country: "US",
    taxId: "US EIN ending 2146",
    industry: "digital-services",
    productDescription:
      "Digital workspace templates, implementation support, and design system services.",
  },
  publicProfile: {
    publicName: "Cedar & Volt Studio",
    supportPhone: "+1 503 555 0184",
    supportEmail: "support@cedarvolt.studio",
    statementDescriptor: "CEDARVOLT.STUDIO",
    website: "https://cedarvolt.studio",
    supportUrl: "https://cedarvolt.studio/help",
    customerSupportNote:
      "Customers see this profile on receipts, hosted invoices, and payment links.",
  },
  management: {
    representativeName: "Mira Coleman",
    representativeRole: "executive-owner",
    representativeEmail: "mira@cedarvolt.studio",
    dateOfBirth: "Born on May 18, 1987",
    addressLine1: "730 Alder Way",
    city: "Portland",
    region: "OR",
    postalCode: "97209",
    country: "US",
    phone: "+1 503 555 0171",
    ssnLast4: "Last 4 SSN ending 4481",
    ownerName: "Elliot Reyes",
    ownerRole: "Owner",
    ownerEmail: "elliot@cedarvolt.studio",
    ownerStatus: "provided",
  },
}