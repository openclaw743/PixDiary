variable "name_prefix" {
  type = string
}

variable "location" {
  type        = string
  description = "Region for SWA. Must be one of: westeurope, westus2, centralus, eastus2, eastasia."
  default     = "westeurope"
}

variable "resource_group_name" {
  type = string
}

variable "container_app_fqdn" {
  type        = string
  default     = ""
  description = "Container App FQDN exposed to the SWA build via app_settings.BACKEND_API_BASE_URL"
}

variable "container_app_id" {
  type    = string
  default = ""
}

variable "app_settings" {
  type    = map(string)
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
