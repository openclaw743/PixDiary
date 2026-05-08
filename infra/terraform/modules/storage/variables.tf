variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "storage_account_name" {
  type        = string
  description = "Storage account name (3-24 lowercase alphanumeric)"
}

variable "container_name" {
  type    = string
  default = "photos"
}

variable "allowed_cors_origins" {
  type        = list(string)
  description = "Allowed CORS origins for the photos container (SWA + localhost dev)"
}

variable "allowed_subnet_ids" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
