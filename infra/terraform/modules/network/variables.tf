variable "name_prefix" {
  type        = string
  description = "Prefix for resource names (e.g. pixdiary-dev)"
}

variable "location" {
  type        = string
  description = "Azure region"
}

variable "resource_group_name" {
  type        = string
  description = "Existing resource group name"
}

variable "vnet_cidr" {
  type        = string
  description = "VNet address space"
  default     = "10.30.0.0/16"
}

variable "container_app_subnet_cidr" {
  type        = string
  description = "Container App subnet (must be at least /23 for ACA Consumption)"
  default     = "10.30.0.0/23"
}

variable "postgres_subnet_cidr" {
  type        = string
  description = "Postgres Flexible Server subnet"
  default     = "10.30.4.0/24"
}

variable "tags" {
  type    = map(string)
  default = {}
}
