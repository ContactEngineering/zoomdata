.. _contributing:

Contributing to zoomdata
************************

Development branches
====================

New features should be developed always in its own branch. When creating your
own branch, please suffix that branch by the year of creation on a
description of what is contains. For example, if you are working on an
implementation for hyperdimensional scans and you started that work in 2048,
the branch could be called "48_hyperdimensional_scans".

Commits
=======

Prepend your commits and merge requests with a shortcut indicating the type
of changes they contain:

* API: changes to the user exposed API
* BUG: Bug fix
* BUILD: Changes to the build system
* CI: Changes to the CI configuration
* DOC: Changes to documentation strings or documentation in general (not only typos)
* ENH: Enhancement (e.g. a new feature)
* MAINT: Maintenance (e.g. fixing a typo, or changing code without affecting function)
* TST: Changes to the unit test environment
* WIP: Work in progress

The changelog will be based on the content of the commits with tag BUG, API and ENH.

Examples:

- If your are working on a new feature, use ENH on the commit making the feature ready. Before use the WIP tag.
- use TST when your changes only deal with the testing environment. If you fix a bug and implement the test for it, use BUG.
- minor changes that doesn't change the codes behaviour (for example rewrite file in a cleaner or slightly efficienter way) belong to the tag MAINT
- if you change documentation files without changing the code, use DOC; if you also change code in the same commit, use another shortcut

Authors
=======

Add yourself to the AUTHORS file using the email address that you are using for your
commits. We use this information to automatically generate copyright statements for
all files from the commit log.
