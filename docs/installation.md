---
title: Installation
description: Import the solution and make the control available.
order: 2
---

# Installation

::steps
1. **Download the solution.** Take `Solution_managed.zip` from the
   [latest release](https://github.com/pcfhub/pcf-data-table/releases). Use the
   managed build unless you intend to edit the component in the target
   environment — `Solution_unmanaged.zip` is the editable one.
2. **Import it.** In the Power Platform admin centre or make.powerapps.com,
   choose **Solutions → Import solution**, pick the zip, and let it complete.
3. **Publish all customizations.** A code component that has been imported but
   not published does not appear in the component list.
4. **Add it to a form or app.** See [Model-driven apps](model-driven.md) or
   [Canvas apps](canvas.md).
::

:::callout{type=warning}
Canvas apps need code components switched on for the environment before the
control appears: **Settings → Product → Features → Power Apps component
framework for canvas apps**. This is an environment-level setting and it is off
by default.
:::

## Upgrading

Import the newer managed solution over the old one — the publisher and solution
unique name are unchanged between releases, so it upgrades in place rather than
installing a second copy. Publish afterwards.
