variable "subscription_id" {
  type        = string
  description = "Azure subscription ID"
  default     = "427d4176-864a-44c1-8470-468709ff9252"
}

variable "resource_group_name" {
  type        = string
  description = "Existing resource group; data-sourced, never created"
  default     = "rg-Sandbox"
}

variable "region" {
  type        = string
  description = "Primary region. westeurope required for SWA availability."
  default     = "westeurope"
}

variable "name_prefix" {
  type        = string
  description = "Resource name prefix"
  default     = "pixdiary-dev"
}

variable "storage_account_name" {
  type        = string
  description = "Globally unique storage account name (3-24 lowercase alphanumeric)"
  default     = "stpixdiarydev"
}

variable "swa_dev_origin" {
  type        = string
  description = "Local dev origin allowed in storage CORS"
  default     = "http://localhost:5173"
}

variable "tags" {
  type = map(string)
  default = {
    project    = "pixdiary"
    env        = "dev"
    managed-by = "terraform"
    owner      = "infraguy"
  }
}
