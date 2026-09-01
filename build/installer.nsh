; Klasik kurulum: kisayol secim sayfasi (varsayilan: ikisi de acik)
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var ExtraDialog
Var ChkDesktop
Var ChkStartMenu
Var DoDesktopShortcut
Var DoStartMenuShortcut

!macro customPageAfterChangeDir
  Page custom ExtraTasksCreate ExtraTasksLeave
!macroend

Function ExtraTasksCreate
  ${If} $DoDesktopShortcut == ""
    StrCpy $DoDesktopShortcut "1"
  ${EndIf}
  ${If} $DoStartMenuShortcut == ""
    StrCpy $DoStartMenuShortcut "1"
  ${EndIf}

  nsDialogs::Create 1018
  Pop $ExtraDialog
  ${If} $ExtraDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Kurulum sirasinda olusturulacak kisayollar:"
  Pop $0

  ${NSD_CreateCheckbox} 0 32u 100% 14u "Masaustunde kisayol olustur  (Create a desktop shortcut)"
  Pop $ChkDesktop
  ${If} $DoDesktopShortcut == "1"
    ${NSD_Check} $ChkDesktop
  ${EndIf}

  ${NSD_CreateCheckbox} 0 52u 100% 14u "Baslat menusune kisayol ekle  (Create a Start Menu shortcut)"
  Pop $ChkStartMenu
  ${If} $DoStartMenuShortcut == "1"
    ${NSD_Check} $ChkStartMenu
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function ExtraTasksLeave
  ${NSD_GetState} $ChkDesktop $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DoDesktopShortcut "1"
  ${Else}
    StrCpy $DoDesktopShortcut "0"
  ${EndIf}
  ${NSD_GetState} $ChkStartMenu $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $DoStartMenuShortcut "1"
  ${Else}
    StrCpy $DoStartMenuShortcut "0"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $DoDesktopShortcut == "0"
    Delete "$newDesktopLink"
  ${EndIf}
  ${If} $DoStartMenuShortcut == "0"
    Delete "$newStartMenuLink"
  ${EndIf}
!macroend
