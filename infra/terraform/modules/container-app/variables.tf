variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "container_app_subnet_id" {
  type = string
}

variable "user_assigned_identity_id" {
  type        = string
  description = "Pre-created user-assigned managed identity ID"
}

variable "user_assigned_identity_client_id" {
  type        = string
  description = "Pre-created user-assigned managed identity client ID"
}

variable "container_image" {
  type        = string
  description = "Initial container image (placeholder until CD pushes a real image). Use a public image to bootstrap; CD updates this."
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
}

variable "acr_login_server" {
  type        = string
  default     = ""
  description = "ACR login server, e.g. acrpixdiary.azurecr.io. Empty disables ACR pull identity."
}

variable "storage_account_name" {
  type = string
}

variable "storage_container_name" {
  type = string
}

variable "openai_endpoint" {
  type = string
}

variable "openai_default_deployment" {
  type = string
}

variable "openai_high_deployment" {
  type = string
}

variable "kv_postgres_connection_string_id" {
  type = string
}

variable "kv_storage_connection_string_id" {
  type = string
}

variable "kv_maps_subscription_key_id" {
  type = string
}

variable "kv_jwt_secret_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
