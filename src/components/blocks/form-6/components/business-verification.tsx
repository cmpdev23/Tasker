"use client"

import { useState, type ReactNode } from "react"
import { type BadgeProps } from "@/components/reui/badge"
import { toast } from "sonner"

import { PaypalWordmark } from "@/components/ui/svgs/paypalWordmark"
import { StripeWordmark } from "@/components/ui/svgs/stripeWordmark"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  BUSINESS_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  DEFAULT_VERIFICATION_PROFILE,
  INDUSTRY_OPTIONS,
  OWNER_STATUS_OPTIONS,
  REPRESENTATIVE_ROLE_OPTIONS,
  type VerificationProfile,
  type VerificationSectionId,
  type VerificationSelectOption,
} from "./data"
import { EditSectionDialog } from "./edit-section-dialog"
import {
  InfoRows,
  PanelHeading,
  StackedValue,
  VerificationSection,
  type InfoRowItem,
} from "./verification-section"
import { ExternalLinkIcon, HelpCircleIcon, ShieldCheckIcon, EyeIcon, StarIcon, PencilIcon, PlusIcon, ChevronUpIcon, ChevronDownIcon, CircleCheckIcon } from "lucide-react"

function getOptionLabel(options: VerificationSelectOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

function formatWebsite(value: string) {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "")
}

function getWebsiteHref(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function BusinessWebsiteLink({ href }: { href: string }) {
  return (
    <a
      href={getWebsiteHref(href)}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex min-w-0 items-center gap-1.5 hover:underline hover:underline-offset-4"
    >
      <span className="min-w-0 truncate">{formatWebsite(href)}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  )
}

function HeaderSupportButton() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() =>
        toast.message("Verification support", {
          description:
            "A compliance specialist can review document and source matches.",
        })
      }
    >
      <HelpCircleIcon data-icon="inline-start" aria-hidden="true" />
      Contact support
    </Button>
  )
}

type VerificationSource = "stripe" | "paypal"

function VerificationSourceLogos({
  sources,
}: {
  sources: VerificationSource[]
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {sources.map((source) => {
        if (source === "stripe") {
          return (
            <BrandLogo key={source} label="Stripe">
              <StripeWordmark className="h-4 w-auto" aria-hidden="true" />
            </BrandLogo>
          )
        }

        return (
          <BrandLogo key={source} label="PayPal">
            <PaypalWordmark className="h-4 w-auto" aria-hidden="true" />
          </BrandLogo>
        )
      })}
    </span>
  )
}

function RowValueWithSources({
  children,
  sources,
}: {
  children: ReactNode
  sources: VerificationSource[]
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-0">{children}</span>
      <VerificationSourceLogos sources={sources} />
    </span>
  )
}

function VerifiedDomainBadgeIcon() {
  return (
    <ShieldCheckIcon aria-hidden="true" />
  )
}

function CustomerVisibleBadgeIcon() {
  return (
    <EyeIcon aria-hidden="true" />
  )
}

function PrimaryBadgeIcon() {
  return (
    <StarIcon aria-hidden="true" />
  )
}

function BrandLogo({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <span className="inline-flex h-5 items-center" aria-label={label}>
      {children}
    </span>
  )
}

function EditButton({
  label = "Edit",
  ariaLabel,
  onClick,
}: {
  label?: string
  ariaLabel?: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <PencilIcon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  )
}

function AddOwnerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      Add owner
    </Button>
  )
}

function ToggleOwnerButton({
  expanded,
  onClick,
}: {
  expanded: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {expanded ? (
        <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />
      ) : (
        <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />
      )}
      {expanded ? "Hide owner" : "Show 1 more owner"}
    </Button>
  )
}

function getOwnerStatusBadgeVariant(status: string): BadgeProps["variant"] {
  if (status === "verified") {
    return "success-light"
  }

  if (status === "needs-review") {
    return "destructive-light"
  }

  return "warning-light"
}

function getBusinessRows(profile: VerificationProfile): InfoRowItem[] {
  const { business } = profile

  return [
    {
      label: "URL",
      value: <BusinessWebsiteLink href={business.website} />,
      labelHint: "Public domain used for verification.",
      valueHint: "Checked against payment and support records.",
    },
    {
      label: "Address",
      value: (
        <StackedValue
          values={[
            business.addressLine1,
            `${business.city}, ${business.region} ${business.postalCode}`,
            getOptionLabel(COUNTRY_OPTIONS, business.country),
          ]}
        />
      ),
      labelHint: "Registered operating address submitted for review.",
    },
    {
      label: "Business type",
      value: getOptionLabel(BUSINESS_TYPE_OPTIONS, business.businessType),
      labelHint: "Entity type changes which verification evidence is required.",
    },
    {
      label: "Other information provided",
      value: [
        business.taxId,
        getOptionLabel(INDUSTRY_OPTIONS, business.industry),
        "Product description",
      ].join(", "),
      valueHint: "Sensitive identifiers stay masked in the view state.",
    },
  ]
}

function getPublicRows(profile: VerificationProfile): InfoRowItem[] {
  const { publicProfile } = profile

  return [
    {
      label: "Business name",
      value: (
        <RowValueWithSources sources={["stripe"]}>
          {publicProfile.publicName}
        </RowValueWithSources>
      ),
      labelHint: "Name shown at checkout.",
    },
    {
      label: "Support phone",
      value: publicProfile.supportPhone,
    },
    {
      label: "Support email",
      value: publicProfile.supportEmail,
      valueHint: "Support contacts should resolve to a monitored inbox.",
    },
    {
      label: "Statement descriptor",
      value: (
        <RowValueWithSources sources={["paypal"]}>
          {publicProfile.statementDescriptor}
        </RowValueWithSources>
      ),
      labelHint: "Bank statement label.",
    },
    {
      label: "Also provided",
      value: "Business website, Support URL, Customer support note",
    },
  ]
}

function getRepresentativeRows(profile: VerificationProfile): InfoRowItem[] {
  const { management } = profile

  return [
    {
      label: "Role",
      value: getOptionLabel(
        REPRESENTATIVE_ROLE_OPTIONS,
        management.representativeRole
      ),
      labelHint: "The role confirms authority to represent the account.",
    },
    {
      label: "Email",
      value: management.representativeEmail,
    },
    {
      label: "Date of birth",
      value: management.dateOfBirth,
      valueHint:
        "Personal data is summarized for review and should stay masked where possible.",
    },
    {
      label: "Address",
      value: (
        <StackedValue
          values={[
            management.addressLine1,
            `${management.city}, ${management.region} ${management.postalCode}`,
            getOptionLabel(COUNTRY_OPTIONS, management.country),
          ]}
        />
      ),
    },
    {
      label: "Other information provided",
      value: [management.ssnLast4, "Phone"].join(", "),
      valueHint:
        "Identity and phone details are present but not fully exposed.",
    },
  ]
}

function getOwnerRows(profile: VerificationProfile): InfoRowItem[] {
  const { management } = profile

  return [
    {
      label: "Role",
      value: management.ownerRole,
    },
    {
      label: "Email",
      value: management.ownerEmail,
    },
    {
      label: "Status",
      value: getOptionLabel(OWNER_STATUS_OPTIONS, management.ownerStatus),
      labelHint: "Owner state controls whether follow-up is needed.",
    },
  ]
}

function getToastIcon() {
  return (
    <CircleCheckIcon className="text-success size-4 shrink-0" aria-hidden="true" />
  )
}

function ToastTitle({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      <span className="min-w-0">{children}</span>
    </span>
  )
}

function ToastDescription({ children }: { children: string }) {
  return (
    <span className="grid grid-cols-[1rem_1fr] gap-2">
      <span aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

function showSavedToast(section: VerificationSectionId) {
  const label =
    section === "business"
      ? "Business details"
      : section === "public"
        ? "Public details"
        : "Management details"

  toast.success(
    <ToastTitle icon={getToastIcon()}>{`${label} saved`}</ToastTitle>,
    {
      description: (
        <ToastDescription>
          The view mode summary now reflects the updated form values.
        </ToastDescription>
      ),
      icon: null,
    }
  )
}

export function BusinessVerification() {
  const [profile, setProfile] = useState(DEFAULT_VERIFICATION_PROFILE)
  const [activeSection, setActiveSection] =
    useState<VerificationSectionId | null>(null)
  const [showAdditionalOwner, setShowAdditionalOwner] = useState(false)

  function openSection(section: VerificationSectionId) {
    setActiveSection(section)
  }

  function handleSave(nextProfile: VerificationProfile) {
    if (!activeSection) {
      return
    }

    setProfile(nextProfile)
    showSavedToast(activeSection)
    setActiveSection(null)
  }

  return (
    <TooltipProvider delay={200}>
      <section className="w-full max-w-4xl" aria-labelledby="form-6-title">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id="form-6-title"
              className="text-lg leading-tight font-semibold"
            >
              Business Verification
            </h2>
            <p className="text-muted-foreground text-sm">
              Review submitted profile details before approval.
            </p>
          </div>
          <HeaderSupportButton />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4">
          <VerificationSection
            title="Business Details"
            description="Legal identity and address."
            action={
              <EditButton
                ariaLabel="Edit business details"
                onClick={() => openSection("business")}
              />
            }
          >
            <PanelHeading
              title={profile.business.legalName}
              description="Domain confirmed for review."
              badge="Verified domain"
              badgeIcon={<VerifiedDomainBadgeIcon />}
              badgeVariant="success-light"
            />
            <InfoRows rows={getBusinessRows(profile)} />
          </VerificationSection>

          <VerificationSection
            title="Public Details"
            description="Customer-facing profile."
            action={
              <EditButton
                ariaLabel="Edit public details"
                onClick={() => openSection("public")}
              />
            }
          >
            <PanelHeading
              title="Customer Support Information"
              description="Receipt and invoice profile."
              badge="Customer visible"
              badgeIcon={<CustomerVisibleBadgeIcon />}
              badgeVariant="info-light"
            />
            <InfoRows rows={getPublicRows(profile)} />
          </VerificationSection>

          <VerificationSection
            title="Management and Ownership"
            description="People authorized to represent the business."
            action={
              <>
                <AddOwnerButton
                  onClick={() => {
                    setShowAdditionalOwner(true)
                    openSection("management")
                  }}
                />
                <EditButton
                  ariaLabel="Edit management and ownership"
                  onClick={() => openSection("management")}
                />
              </>
            }
          >
            <PanelHeading
              title={profile.management.representativeName}
              description="Account representative"
              badge="Primary"
              badgeIcon={<PrimaryBadgeIcon />}
              badgeVariant="primary-light"
            />
            <InfoRows rows={getRepresentativeRows(profile)} />

            <Separator />

            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium">
                  Beneficial ownership
                </p>
                <p className="text-muted-foreground truncate text-sm">
                  1 additional owner provided.
                </p>
              </div>
              <ToggleOwnerButton
                expanded={showAdditionalOwner}
                onClick={() => setShowAdditionalOwner((current) => !current)}
              />
            </div>

            {showAdditionalOwner ? (
              <>
                <Separator />
                <PanelHeading
                  title={profile.management.ownerName}
                  description="Additional owner"
                  badge={getOptionLabel(
                    OWNER_STATUS_OPTIONS,
                    profile.management.ownerStatus
                  )}
                  badgeVariant={getOwnerStatusBadgeVariant(
                    profile.management.ownerStatus
                  )}
                />
                <InfoRows rows={getOwnerRows(profile)} />
              </>
            ) : null}
          </VerificationSection>
        </div>

        {activeSection ? (
          <EditSectionDialog
            key={activeSection}
            section={activeSection}
            profile={profile}
            open
            onOpenChange={(open) => {
              if (!open) {
                setActiveSection(null)
              }
            }}
            onSave={handleSave}
          />
        ) : null}
      </section>
    </TooltipProvider>
  )
}