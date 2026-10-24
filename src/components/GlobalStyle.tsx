import {createGlobalStyle} from "styled-components";

const GlobalStyle = createGlobalStyle`
    @font-face {
        font-family: 'SuperChildishFont';
        src: url("../assets/super-childish-font/SuperChildish-1jYoL.ttf") ;
    }
    
    header h1{
        font-family: 'SuperChildishFont', "Comic Sans MS", Papyrus, fantasy;
    }
`;


export default GlobalStyle;