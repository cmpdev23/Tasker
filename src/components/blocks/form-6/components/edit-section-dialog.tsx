"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  BUSINESS_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  INDUSTRY_OPTIONS,
  OWNER_STATUS_OPTIONS,
  REPRESENTATIVE_ROLE_OPTIONS,
  type BusinessDetails,
  type ManagementDetails,
  type PublicDetails,
  type VerificationProfile,
  type VerificationSectionId,
  type VerificationSelectOption,
} from "./data"
import { InfoIcon, SaveIcon } from "lucide-react"

function getOptionLabel(options: VerificationSelectOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value
}

function getDialogCopy(section: VerificationSectionId) {
  if (section === "business") {
    return {
      title: "Edit Business Details",
      description: "Update the legal profile used for account review.",
    }
  }

  if (section === "public") {
    return {
      title: "Edit Public Details",
      description:
        "Update the customer-facing information shown after payment.",
    }
  }

  return {
    title: "Edit Management",
    description: "Update the representative and owner information on file.",
  }
}

function FieldHint({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground -my-1"
            aria-label={label}
          />
        }
      >
        <InfoIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

function FieldLabelWithHint({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string
  children: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{children}</FieldLabel>
      {hint ? <FieldHint label={`${children} info`}>{hint}</FieldHint> : null}
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  description,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  description?: string
  hint?: string
}) {
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <Field className="gap-2">
      <FieldLabelWithHint htmlFor={id} hint={hint}>
        {label}
      </FieldLabelWithHint>
      <Input
        id={id}
        type={type}
        value={value}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

function TextareaField({
  id,
  label,
  value,
  onChange,
  description,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  description?: string
  hint?: string
}) {
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <Field className="gap-2">
      <FieldLabelWithHint htmlFor={id} hint={hint}>
        {label}
      </FieldLabelWithHint>
      <Textarea
        id={id}
        value={value}
        aria-describedby={descriptionId}
        className="min-h-24 resize-none"
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

function SelectField({
  id,
  label,
  value,
  options,
  onValueChange,
  hint,
}: {
  id: string
  label: string
  value: string
  options: VerificationSelectOption[]
  onValueChange: (value: string) => void
  hint?: string
}) {
  return (
    <Field className="gap-2">
      <FieldLabelWithHint htmlFor={id} hint={hint}>
        {label}
      </FieldLabelWithHint>
      <Select
        value={value}
        onValueChange={(nextValue) => nextValue && onValueChange(nextValue)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{getOptionLabel(options, value)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function BusinessFields({
  values,
  onChange,
}: {
  values: BusinessDetails
  onChange: (field: keyof BusinessDetails, value: string) => void
}) {
  return (
    <FieldGroup className="gap-6">
      <TextField
        id="form-6-legal-name"
        label="Legal name"
        value={values.legalName}
        hint="Must match the entity name on tax and banking records."
        onChange={(value) => onChange("legalName", value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="form-6-business-type"
          label="Business type"
          value={values.businessType}
          options={BUSINESS_TYPE_OPTIONS}
          hint="Used to determine the verification evidence required for the account."
          onValueChange={(value) => onChange("businessType", value)}
        />
        <SelectField
          id="form-6-industry"
          label="Industry"
          value={values.industry}
          options={INDUSTRY_OPTIONS}
          hint="Helps reviewers understand the business model and risk profile."
          onValueChange={(value) => onChange("industry", value)}
        />
      </div>
      <TextField
        id="form-6-business-website"
        label="Website"
        type="url"
        value={values.website}
        hint="Reviewers compare this domain with the public profile and product description."
        onChange={(value) => onChange("website", value)}
      />
      <TextField
        id="form-6-business-address"
        label="Street address"
        value={values.addressLine1}
        onChange={(value) => onChange("addressLine1", value)}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_0.55fr_0.7fr]">
        <TextField
          id="form-6-business-city"
          label="City"
          value={values.city}
          onChange={(value) => onChange("city", value)}
        />
        <TextField
          id="form-6-business-region"
          label="State"
          value={values.region}
          onChange={(value) => onChange("region", value)}
        />
        <TextField
          id="form-6-business-postal"
          label="Postal code"
          value={values.postalCode}
          onChange={(value) => onChange("postalCode", value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="form-6-business-country"
          label="Country"
          value={values.country}
          options={COUNTRY_OPTIONS}
          onValueChange={(value) => onChange("country", value)}
        />
        <TextField
          id="form-6-business-tax-id"
          label="Tax ID"
          value={values.taxId}
          hint="Store a masked identifier in UI and keep the full value server-side."
          onChange={(value) => onChange("taxId", value)}
        />
      </div>
      <TextareaField
        id="form-6-product-description"
        label="Product description"
        value={values.productDescription}
        description="Shown to reviewers when the business profile is checked."
        hint="Keep this specific enough to explain what customers pay for."
        onChange={(value) => onChange("productDescription", value)}
      />
    </FieldGroup>
  )
}

function PublicFields({
  values,
  onChange,
}: {
  values: PublicDetails
  onChange: (field: keyof PublicDetails, value: string) => void
}) {
  return (
    <FieldGroup className="gap-6">
      <TextField
        id="form-6-public-name"
        label="Public name"
        value={values.publicName}
        hint="This appears on receipts and hosted payment pages."
        onChange={(value) => onChange("publicName", value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="form-6-statement-descriptor"
          label="Statement descriptor"
          value={values.statementDescriptor}
          hint="Use a short recognizable value that customers can identify on a bank statement."
          onChange={(value) => onChange("statementDescriptor", value)}
        />
        <TextField
          id="form-6-support-phone"
          label="Support phone"
          value={values.supportPhone}
          onChange={(value) => onChange("supportPhone", value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="form-6-support-email"
          label="Support email"
          type="email"
          value={values.supportEmail}
          onChange={(value) => onChange("supportEmail", value)}
        />
        <TextField
          id="form-6-public-website"
          label="Business website"
          type="url"
          value={values.website}
          hint="Should resolve to the same business shown in the legal profile."
          onChange={(value) => onChange("website", value)}
        />
      </div>
      <TextField
        id="form-6-support-url"
        label="Support URL"
        type="url"
        value={values.supportUrl}
        onChange={(value) => onChange("supportUrl", value)}
      />
      <TextareaField
        id="form-6-customer-note"
        label="Customer support note"
        value={values.customerSupportNote}
        hint="Shown only as support context; keep it short and customer-safe."
        onChange={(value) => onChange("customerSupportNote", value)}
      />
    </FieldGroup>
  )
}

function ManagementFields({
  values,
  onChange,
}: {
  values: ManagementDetails
  onChange: (field: keyof ManagementDetails, value: string) => void
}) {
  return (
    <FieldGroup className="gap-6">
      <TextField
        id="form-6-representative-name"
        label="Representative name"
        value={values.representativeName}
        hint="The representative should be authorized to act for this business."
        onChange={(value) => onChange("representativeName", value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="form-6-representative-role"
          label="Representative role"
          value={values.representativeRole}
          options={REPRESENTATIVE_ROLE_OPTIONS}
          hint="Role determines which ownership and control attestations are required."
          onValueChange={(value) => onChange("representativeRole", value)}
        />
        <TextField
          id="form-6-representative-email"
          label="Representative email"
          type="email"
          value={values.representativeEmail}
          onChange={(value) => onChange("representativeEmail", value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="form-6-representative-birth-date"
          label="Date of birth"
          value={values.dateOfBirth}
          hint="Used for identity checks. Avoid showing unnecessary raw personal data."
          onChange={(value) => onChange("dateOfBirth", value)}
        />
        <TextField
          id="form-6-representative-phone"
          label="Phone"
          value={values.phone}
          onChange={(value) => onChange("phone", value)}
        />
      </div>
      <TextField
        id="form-6-representative-address"
        label="Street address"
        value={values.addressLine1}
        onChange={(value) => onChange("addressLine1", value)}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_0.55fr_0.7fr]">
        <TextField
          id="form-6-representative-city"
          label="City"
          value={values.city}
          onChange={(value) => onChange("city", value)}
        />
        <TextField
          id="form-6-representative-region"
          label="State"
          value={values.region}
          onChange={(value) => onChange("region", value)}
        />
        <TextField
          id="form-6-representative-postal"
          label="Postal code"
          value={values.postalCode}
          onChange={(value) => onChange("postalCode", value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="form-6-representative-country"
          label="Country"
          value={values.country}
          options={COUNTRY_OPTIONS}
          onValueChange={(value) => onChange("country", value)}
        />
        <TextField
          id="form-6-representative-ssn"
          label="Identity number"
          value={values.ssnLast4}
          hint="Display only a masked value in the client UI."
          onChange={(value) => onChange("ssnLast4", value)}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          id="form-6-owner-name"
          label="Additional owner"
          value={values.ownerName}
          onChange={(value) => onChange("ownerName", value)}
        />
        <TextField
          id="form-6-owner-email"
          label="Owner email"
          type="email"
          value={values.ownerEmail}
          onChange={(value) => onChange("ownerEmail", value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="form-6-owner-role"
          label="Owner role"
          value={values.ownerRole}
          onChange={(value) => onChange("ownerRole", value)}
        />
        <SelectField
          id="form-6-owner-status"
          label="Owner status"
          value={values.ownerStatus}
          options={OWNER_STATUS_OPTIONS}
          hint="Use this state to decide whether the owner needs follow-up."
          onValueChange={(value) => onChange("ownerStatus", value)}
        />
      </div>
    </FieldGroup>
  )
}

export function EditSectionDialog({
  section,
  profile,
  open,
  onOpenChange,
  onSave,
}: {
  section: VerificationSectionId
  profile: VerificationProfile
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (profile: VerificationProfile) => void
}) {
  const [draft, setDraft] = useState(() => profile)
  const copy = getDialogCopy(section)

  function updateBusiness(field: keyof BusinessDetails, value: string) {
    setDraft((current) => ({
      ...current,
      business: {
        ...current.business,
        [field]: value,
      },
    }))
  }

  function updatePublic(field: keyof PublicDetails, value: string) {
    setDraft((current) => ({
      ...current,
      publicProfile: {
        ...current.publicProfile,
        [field]: value,
      },
    }))
  }

  function updateManagement(field: keyof ManagementDetails, value: string) {
    setDraft((current) => ({
      ...current,
      management: {
        ...current.management,
        [field]: value,
      },
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(draft)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          {/* Header */}
          <DialogHeader className="shrink-0 gap-1 px-5 pt-5 pr-12 pb-4 text-left">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <Separator className="shrink-0" />

          {/* Fields */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {section === "business" ? (
              <BusinessFields
                values={draft.business}
                onChange={updateBusiness}
              />
            ) : null}

            {section === "public" ? (
              <PublicFields
                values={draft.publicProfile}
                onChange={updatePublic}
              />
            ) : null}

            {section === "management" ? (
              <ManagementFields
                values={draft.management}
                onChange={updateManagement}
              />
            ) : null}
          </div>

          {/* Footer */}
          <DialogFooter className="m-0 flex-row items-center justify-end gap-2 border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              <SaveIcon data-icon="inline-start" aria-hidden="true" />
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}