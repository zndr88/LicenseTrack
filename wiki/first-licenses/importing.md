# You're in! Now what?

Chances are you already have software licenses to manage, so this blank canvas won't stay blank for long.

LicenseTrack is designed to easily import existing spreadsheets, or to convert custom spreadsheets into its format. Navigate to **Import**:

![Navigating to the Import page](../assets/import-01-navigate.png)

## Start from the template

Select your desired settings, download the template, and review it:

![The import template with three pre-filled example rows](../assets/import-02-template.png)

As you can see, it comes with three pre-filled lines that give you an idea of how LicenseTrack handles its data.

You have two ways to get your data in:

- **Use this template** to migrate your own license data into the known default format, or
- **Use the "External Tool Import" source** to bring in your own custom file, then save the configuration as a preset once you've mapped it.

When a file contains an **LT Ref** column, either path offers an auto-enabled option to update the current matching license instead of creating a duplicate. This makes it safe to export a list, make small spreadsheet corrections, and re-import it. Turn the option off when you intentionally want new records.

Native Import also recognizes existing custom fields. **Export Full Data** writes their stable `cf_*` keys as headers, so custom values round-trip automatically. Files that use the custom field's display name are also matched when that name identifies one field unambiguously. During an LT Ref update, a nonblank custom-field value is patched and a blank cell preserves the value already stored.

## Mapping a custom file

Below is an example of a custom file that matches the template and also includes a unique field. You can map it to an existing **custom field**; admins can create a new definition when one does not exist:

![Animated walkthrough of mapping a custom import file](../assets/import-03-custom-mapping.gif)

## Review your imported licenses

Once imported, the licenses appear in the **License Overview** page:

![The License Overview page populated with imported licenses](../assets/import-04-license-overview.png)

This is a good opportunity to help you understand the license record as it exists in LicenseTrack.

<div class="page-nav" markdown>
[:material-arrow-right: Understanding the license record](license-record.md)
</div>
