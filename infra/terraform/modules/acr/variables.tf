variable "name_prefix" {
  type = string
}
variable "location" {
  type = string
}
variable "resource_group_name" {
  type = string
}
variable "container_app_principal_id" {
  type        = string
  description = "Container App user-assigned managed identity principal id (for AcrPull)."
}
variable "deploy_principal_id" {
  type        = string
  default     = ""
  description = "Optional: deploy UAMI principal id (for AcrPush). Empty disables the role assignment."
}
variable "tags" {
  type    = map(string)
  default = {}
}
